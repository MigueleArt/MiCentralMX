-- Migración 0008: Origen en venta_renglones y tercera comparación en conciliación nocturna

-- 1. Origen en renglones de venta
alter table venta_renglones add column if not exists origen_nombre text;

-- 2. Tipo en alertas_inventario e índice único actualizado
alter table alertas_inventario add column if not exists tipo text not null default 'descuadre';

drop index if exists alertas_inventario_abierta;
create unique index alertas_inventario_abierta on alertas_inventario (
  clasificacion_id,
  coalesce(carga_id, '00000000-0000-0000-0000-000000000000'::uuid),
  tipo
) where resuelta_en is null;

-- 3. Función de conciliación nocturna con 3 comparaciones:
-- (1) General: existencias.cantidad <> sum(movimientos_inventario.delta)
-- (2) Carga: existencias_carga.cantidad <> sum(movimientos con carga_id)
-- (3) Derivada: sum(existencias_carga.cantidad) > existencias.cantidad
create or replace function conciliar_existencias() returns table (abiertas integer, cerradas integer)
language plpgsql as $$
declare
  v_abiertas integer := 0;
  v_cerradas integer := 0;
  v_ins1 integer := 0;
  v_ins2 integer := 0;
  v_ins3 integer := 0;
  v_up1 integer := 0;
  v_up2 integer := 0;
  v_up3 integer := 0;
begin
  -- 1) Conciliación general: clasificaciones
  with suma as (
    select clasificacion_id, sum(delta) as total from movimientos_inventario group by clasificacion_id
  ),
  diferencias as (
    select c.id as clasificacion_id, null::uuid as carga_id, c.negocio_id, coalesce(e.cantidad, 0) as existencia, coalesce(s.total, 0) as suma, 'descuadre'::text as tipo
    from clasificaciones c
    left join existencias e on e.clasificacion_id = c.id
    left join suma s on s.clasificacion_id = c.id
    where coalesce(e.cantidad, 0) <> coalesce(s.total, 0)
  ),
  insertadas1 as (
    insert into alertas_inventario (negocio_id, clasificacion_id, carga_id, tipo, existencia, suma_movimientos)
    select negocio_id, clasificacion_id, carga_id, tipo, existencia, suma from diferencias
    on conflict (clasificacion_id, coalesce(carga_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo) where resuelta_en is null
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
    select ec.clasificacion_id, ec.carga_id, ec.negocio_id, ec.cantidad as existencia, coalesce(sc.total, 0) as suma, 'descuadre'::text as tipo
    from existencias_carga ec
    left join suma_carga sc on sc.carga_id = ec.carga_id and sc.clasificacion_id = ec.clasificacion_id
    where ec.cantidad <> coalesce(sc.total, 0)
  ),
  insertadas2 as (
    insert into alertas_inventario (negocio_id, clasificacion_id, carga_id, tipo, existencia, suma_movimientos)
    select negocio_id, clasificacion_id, carga_id, tipo, existencia, suma from diferencias_carga
    on conflict (clasificacion_id, coalesce(carga_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo) where resuelta_en is null
    do update set existencia = excluded.existencia, suma_movimientos = excluded.suma_movimientos, detectada_en = now()
    returning 1
  )
  select count(*) into v_ins2 from insertadas2;

  -- 3) Conciliación existencia general derivada: suma(existencias_carga) > existencias.cantidad
  with suma_existencias_carga as (
    select clasificacion_id, sum(cantidad) as total_cargas
    from existencias_carga
    group by clasificacion_id
  ),
  diferencias_derivada as (
    select c.id as clasificacion_id, null::uuid as carga_id, c.negocio_id, coalesce(e.cantidad, 0) as existencia, coalesce(sec.total_cargas, 0) as suma, 'carga_excede_total'::text as tipo
    from clasificaciones c
    left join existencias e on e.clasificacion_id = c.id
    inner join suma_existencias_carga sec on sec.clasificacion_id = c.id
    where sec.total_cargas > coalesce(e.cantidad, 0)
  ),
  insertadas3 as (
    insert into alertas_inventario (negocio_id, clasificacion_id, carga_id, tipo, existencia, suma_movimientos)
    select negocio_id, clasificacion_id, carga_id, tipo, existencia, suma from diferencias_derivada
    on conflict (clasificacion_id, coalesce(carga_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo) where resuelta_en is null
    do update set existencia = excluded.existencia, suma_movimientos = excluded.suma_movimientos, detectada_en = now()
    returning 1
  )
  select count(*) into v_ins3 from insertadas3;

  v_abiertas := v_ins1 + v_ins2 + v_ins3;

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
      and a.tipo = 'descuadre'
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
      and a.tipo = 'descuadre'
      and a.carga_id is not null
      and a.carga_id = ec.carga_id
      and a.clasificacion_id = ec.clasificacion_id
      and ec.cantidad = coalesce(sc.total, 0)
    returning 1
  )
  select count(*) into v_up2 from cerradas2;

  -- Cierra alertas de carga_excede_total que ya cuadran
  with suma_existencias_carga as (
    select clasificacion_id, sum(cantidad) as total_cargas
    from existencias_carga
    group by clasificacion_id
  ),
  cerradas3 as (
    update alertas_inventario a
    set resolucion = 'coincide', resuelta_en = now()
    from existencias e
    left join suma_existencias_carga sec on sec.clasificacion_id = e.clasificacion_id
    where a.resuelta_en is null
      and a.tipo = 'carga_excede_total'
      and e.clasificacion_id = a.clasificacion_id
      and coalesce(e.cantidad, 0) >= coalesce(sec.total_cargas, 0)
    returning 1
  )
  select count(*) into v_up3 from cerradas3;

  v_cerradas := v_up1 + v_up2 + v_up3;

  return query select v_abiertas, v_cerradas;
end
$$;

grant execute on function conciliar_existencias() to mc_app, mc_plataforma;
