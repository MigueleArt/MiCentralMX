-- 0007_cargas.sql: Carga del día, existencias por carga, origen de proveedor/rancho y permisos
-- Migración para MiCentralMX · Sprint 2

-- 1. Origen: tipo en proveedores
alter table proveedores add column if not exists tipo text not null default 'tercero' check (tipo in ('tercero', 'rancho_propio'));

-- 2. Cargas del día
create table cargas (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  fecha date not null,
  proveedor_id uuid not null references proveedores (id),
  estado text not null check (estado in ('abierta', 'cerrada')),
  usuario_id uuid not null references usuarios (id),
  usuario_nombre text not null,
  dispositivo_id uuid references dispositivos (id),
  creado_en_dispositivo timestamptz not null,
  cerrada_en timestamptz,
  tx_id xid8 not null default pg_current_xact_id()
);

-- Renglones iniciales inmutables de la carga
create table carga_renglones (
  carga_id uuid not null references cargas (id),
  linea integer not null,
  negocio_id uuid not null references negocios (id),
  clasificacion_id uuid not null references clasificaciones (id),
  cantidad numeric(12, 3) not null check (cantidad > 0),
  tx_id xid8 not null default pg_current_xact_id(),
  primary key (carga_id, linea)
);

-- Existencias por carga y clasificación
create table existencias_carga (
  id uuid primary key default uuidv7(),
  carga_id uuid not null references cargas (id),
  clasificacion_id uuid not null references clasificaciones (id),
  negocio_id uuid not null references negocios (id),
  cantidad numeric(12, 3) not null default 0,
  tx_id xid8 not null default pg_current_xact_id(),
  unique (carga_id, clasificacion_id)
);

-- 3. Movimientos de inventario: enlace a carga y nuevos tipos 'carga' y 'devolucion'
alter table movimientos_inventario add column if not exists carga_id uuid references cargas (id);
alter table movimientos_inventario drop constraint if exists movimientos_inventario_tipo_check;
alter table movimientos_inventario add constraint movimientos_inventario_tipo_check
  check (tipo in ('inicial', 'compra', 'venta', 'merma', 'ajuste', 'cancelacion', 'carga', 'devolucion'));
create index if not exists movimientos_carga on movimientos_inventario (negocio_id, carga_id);

-- 4. Venta renglones: enlace a carga
alter table venta_renglones add column if not exists carga_id uuid references cargas (id);

-- Triggers y cursores de sincronización para cargas
create trigger cargas_tx before update on cargas for each row execute function marcar_tx();
create index cargas_tx_idx on cargas (negocio_id, tx_id);

create trigger carga_renglones_tx before update on carga_renglones for each row execute function marcar_tx();
create index carga_renglones_tx_idx on carga_renglones (negocio_id, tx_id);

create trigger existencias_carga_tx before update on existencias_carga for each row execute function marcar_tx();
create index existencias_carga_tx_idx on existencias_carga (negocio_id, tx_id);

create index cargas_negocio_estado on cargas (negocio_id, estado, fecha);
create index existencias_carga_negocio on existencias_carga (negocio_id, carga_id, clasificacion_id);

-- Row Level Security
alter table cargas enable row level security;
alter table cargas force row level security;
create policy aislamiento_negocio on cargas using (negocio_id = app_negocio()) with check (negocio_id = app_negocio());

alter table carga_renglones enable row level security;
alter table carga_renglones force row level security;
create policy aislamiento_negocio on carga_renglones using (negocio_id = app_negocio()) with check (negocio_id = app_negocio());

alter table existencias_carga enable row level security;
alter table existencias_carga force row level security;
create policy aislamiento_negocio on existencias_carga using (negocio_id = app_negocio()) with check (negocio_id = app_negocio());

-- Grants
grant select, insert, update on cargas, existencias_carga to mc_app;
grant select, insert on carga_renglones to mc_app;
grant select, insert, update on cargas, carga_renglones, existencias_carga to mc_plataforma;

-- Permisos nuevos para Dueño y Administrador
update roles
set permisos = array_append(array_append(permisos, 'cargas.registrar'), 'cargas.cerrar')
where base in ('dueno', 'administrador')
  and not ('cargas.registrar' = any (permisos));

-- Unidades tara con decimales habilitados
update unidades set permite_decimales = true where lower(nombre) = 'tara';

-- Conciliación nocturna por carga
alter table alertas_inventario add column if not exists carga_id uuid references cargas (id);
drop index if exists alertas_inventario_abierta;
create unique index alertas_inventario_abierta on alertas_inventario (clasificacion_id, coalesce(carga_id, '00000000-0000-0000-0000-000000000000'::uuid)) where resuelta_en is null;

create or replace function conciliar_existencias() returns table (abiertas integer, cerradas integer)
language plpgsql as $$
declare
  v_abiertas integer := 0;
  v_cerradas integer := 0;
  v_ins1 integer := 0;
  v_ins2 integer := 0;
  v_up1 integer := 0;
  v_up2 integer := 0;
begin
  -- 1) Conciliación general: clasificaciones
  with suma as (
    select clasificacion_id, sum(delta) as total from movimientos_inventario group by clasificacion_id
  ),
  diferencias as (
    select c.id as clasificacion_id, null::uuid as carga_id, c.negocio_id, coalesce(e.cantidad, 0) as existencia, coalesce(s.total, 0) as suma
    from clasificaciones c
    left join existencias e on e.clasificacion_id = c.id
    left join suma s on s.clasificacion_id = c.id
    where coalesce(e.cantidad, 0) <> coalesce(s.total, 0)
  ),
  insertadas1 as (
    insert into alertas_inventario (negocio_id, clasificacion_id, carga_id, existencia, suma_movimientos)
    select negocio_id, clasificacion_id, carga_id, existencia, suma from diferencias
    on conflict (clasificacion_id, coalesce(carga_id, '00000000-0000-0000-0000-000000000000'::uuid)) where resuelta_en is null
    do update set existencia = excluded.existencia, suma_movimientos = excluded.suma_movimientos, detectada_en = now()
    returning 1
  )
  select count(*) into v_ins1 from insertadas1;

  -- 2) Conciliación por carga
  with suma_carga as (
    select carga_id, clasificacion_id, sum(delta) as total
    from movimientos_inventario
    where carga_id is not null
    group by carga_id, clasificacion_id
  ),
  diferencias_carga as (
    select ec.clasificacion_id, ec.carga_id, ec.negocio_id, ec.cantidad as existencia, coalesce(sc.total, 0) as suma
    from existencias_carga ec
    left join suma_carga sc on sc.carga_id = ec.carga_id and sc.clasificacion_id = ec.clasificacion_id
    where ec.cantidad <> coalesce(sc.total, 0)
  ),
  insertadas2 as (
    insert into alertas_inventario (negocio_id, clasificacion_id, carga_id, existencia, suma_movimientos)
    select negocio_id, clasificacion_id, carga_id, existencia, suma from diferencias_carga
    on conflict (clasificacion_id, coalesce(carga_id, '00000000-0000-0000-0000-000000000000'::uuid)) where resuelta_en is null
    do update set existencia = excluded.existencia, suma_movimientos = excluded.suma_movimientos, detectada_en = now()
    returning 1
  )
  select count(*) into v_ins2 from insertadas2;

  v_abiertas := v_ins1 + v_ins2;

  -- Cierra alertas generales que ya cuadran
  with suma as (
    select clasificacion_id, sum(delta) as total from movimientos_inventario group by clasificacion_id
  ),
  cerradas1 as (
    update alertas_inventario a
    set resolucion = 'coincide', resuelta_en = now()
    from existencias e
    left join suma s on s.clasificacion_id = e.clasificacion_id
    where a.resuelta_en is null
      and a.carga_id is null
      and e.clasificacion_id = a.clasificacion_id
      and e.cantidad = coalesce(s.total, 0)
    returning 1
  )
  select count(*) into v_up1 from cerradas1;

  -- Cierra alertas de carga que ya cuadran
  with suma_carga as (
    select carga_id, clasificacion_id, sum(delta) as total
    from movimientos_inventario
    where carga_id is not null
    group by carga_id, clasificacion_id
  ),
  cerradas2 as (
    update alertas_inventario a
    set resolucion = 'coincide', resuelta_en = now()
    from existencias_carga ec
    left join suma_carga sc on sc.carga_id = ec.carga_id and sc.clasificacion_id = ec.clasificacion_id
    where a.resuelta_en is null
      and a.carga_id is not null
      and a.carga_id = ec.carga_id
      and a.clasificacion_id = ec.clasificacion_id
      and ec.cantidad = coalesce(sc.total, 0)
    returning 1
  )
  select count(*) into v_up2 from cerradas2;

  v_cerradas := v_up1 + v_up2;

  return query select v_abiertas, v_cerradas;
end
$$;

grant execute on function conciliar_existencias() to mc_app, mc_plataforma;
