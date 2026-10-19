-- 0009_cuenta_productor.sql: Liquidaciones (cortes de cuenta) y saldo de productores
-- Migración para MiCentralMX · Sprint 3

-- 1. Comisión en proveedores y cargas
alter table proveedores add column if not exists comision_tipo text check (comision_tipo in ('porcentaje', 'por_unidad'));
alter table proveedores add column if not exists comision_valor numeric(12, 2);

alter table cargas add column if not exists comision_tipo text check (comision_tipo in ('porcentaje', 'por_unidad'));
alter table cargas add column if not exists comision_valor numeric(12, 2);

-- 2. Liquidaciones (cortes de cuenta emitidos)
create table liquidaciones (
  id uuid primary key default uuidv7(),
  negocio_id uuid not null references negocios (id),
  folio integer not null,
  proveedor_id uuid not null references proveedores (id),
  periodo_desde date,
  periodo_hasta date,
  total_vendido numeric(12, 2) not null,
  unidades_vendidas numeric(12, 3) not null,
  comision_tipo text not null check (comision_tipo in ('porcentaje', 'por_unidad')),
  comision_valor numeric(12, 2) not null,
  comision_calculada numeric(12, 2) not null,
  comision_final numeric(12, 2) not null,
  comision_nota text,
  descuentos_total numeric(12, 2) not null default 0,
  neto numeric(12, 2) not null,
  usuario_id uuid not null references usuarios (id),
  usuario_nombre text not null,
  creado_en timestamptz not null default now(),
  tx_id xid8 not null default pg_current_xact_id(),
  unique (negocio_id, folio)
);

-- Renglones de venta incluidos en cada liquidación (UNIQUE venta_id, linea garantiza corte único)
create table liquidacion_renglones (
  liquidacion_id uuid not null references liquidaciones (id) on delete cascade,
  venta_id uuid not null references ventas (id),
  linea integer not null,
  carga_id uuid references cargas (id),
  importe numeric(12, 2) not null,
  unidades numeric(12, 3) not null default 0,
  negocio_id uuid not null references negocios (id),
  tx_id xid8 not null default pg_current_xact_id(),
  primary key (liquidacion_id, venta_id, linea),
  unique (venta_id, linea)
);

-- Conceptos y descuentos de la liquidación (flete, tara, merma, otro)
create table liquidacion_conceptos (
  liquidacion_id uuid not null references liquidaciones (id) on delete cascade,
  linea integer not null,
  tipo text not null check (tipo in ('flete', 'tara', 'merma', 'otro')),
  concepto text not null,
  monto numeric(12, 2) not null check (monto > 0),
  negocio_id uuid not null references negocios (id),
  tx_id xid8 not null default pg_current_xact_id(),
  primary key (liquidacion_id, linea)
);

-- Ajustes a cuenta de productor (cargo o abono por cancelación, incobrable u otros)
create table ajustes_productor (
  id uuid primary key default uuidv7(),
  negocio_id uuid not null references negocios (id),
  proveedor_id uuid not null references proveedores (id),
  tipo text not null check (tipo in ('cargo', 'abono')),
  categoria text not null check (categoria in ('cancelacion', 'incobrable', 'otro')),
  concepto text not null,
  monto numeric(12, 2) not null check (monto > 0),
  venta_id uuid references ventas (id),
  usuario_id uuid not null references usuarios (id),
  usuario_nombre text not null,
  creado_en timestamptz not null default now(),
  tx_id xid8 not null default pg_current_xact_id()
);

-- Triggers de tx y cursores de sincronización
create trigger liquidaciones_tx before update on liquidaciones for each row execute function marcar_tx();
create index liquidaciones_tx_idx on liquidaciones (negocio_id, tx_id);

create trigger liquidacion_renglones_tx before update on liquidacion_renglones for each row execute function marcar_tx();
create index liquidacion_renglones_tx_idx on liquidacion_renglones (negocio_id, tx_id);

create trigger liquidacion_conceptos_tx before update on liquidacion_conceptos for each row execute function marcar_tx();
create index liquidacion_conceptos_tx_idx on liquidacion_conceptos (negocio_id, tx_id);

create trigger ajustes_productor_tx before update on ajustes_productor for each row execute function marcar_tx();
create index ajustes_productor_tx_idx on ajustes_productor (negocio_id, tx_id);

create index liquidaciones_negocio_proveedor on liquidaciones (negocio_id, proveedor_id, creado_en);
create index ajustes_productor_negocio_proveedor on ajustes_productor (negocio_id, proveedor_id, creado_en);

-- Row Level Security
alter table liquidaciones enable row level security;
alter table liquidaciones force row level security;
create policy aislamiento_negocio on liquidaciones using (negocio_id = app_negocio()) with check (negocio_id = app_negocio());

alter table liquidacion_renglones enable row level security;
alter table liquidacion_renglones force row level security;
create policy aislamiento_negocio on liquidacion_renglones using (negocio_id = app_negocio()) with check (negocio_id = app_negocio());

alter table liquidacion_conceptos enable row level security;
alter table liquidacion_conceptos force row level security;
create policy aislamiento_negocio on liquidacion_conceptos using (negocio_id = app_negocio()) with check (negocio_id = app_negocio());

alter table ajustes_productor enable row level security;
alter table ajustes_productor force row level security;
create policy aislamiento_negocio on ajustes_productor using (negocio_id = app_negocio()) with check (negocio_id = app_negocio());

-- Grants
grant select, insert on liquidaciones to mc_app;
grant select, insert on liquidacion_renglones to mc_app;
grant select, insert on liquidacion_conceptos to mc_app;
grant select, insert on ajustes_productor to mc_app;

grant select, insert, update, delete on liquidaciones, liquidacion_renglones, liquidacion_conceptos, ajustes_productor to mc_plataforma;

-- Nuevos permisos para liquidaciones
update roles
set permisos = array_append(array_append(permisos, 'liquidaciones.ver'), 'liquidaciones.gestionar')
where base in ('dueno', 'administrador')
  and not ('liquidaciones.ver' = any (permisos));
