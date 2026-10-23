-- Migración 0011: Multi-sucursal y multi-local para Dueños y encargados
-- Permite vincular varias sucursales/bodegas a una matriz empresarial y que el Dueño
-- cambie entre ellas con su misma cuenta, manteniendo el aislamiento de inventario y RLS.

-- 1. Vincular sucursales a una matriz en la tabla negocios
alter table negocios
  add column if not exists matriz_id uuid references negocios (id) on delete restrict;

create index if not exists negocios_matriz_idx on negocios (matriz_id);

-- 2. Tabla de asignación de usuarios a sucursales adicionales
create table if not exists usuarios_sucursales (
  usuario_id uuid not null references usuarios (id) on delete cascade,
  negocio_id uuid not null references negocios (id) on delete cascade,
  rol_id uuid not null references roles (id) on delete restrict,
  creado_en timestamptz not null default now(),
  primary key (usuario_id, negocio_id)
);

create index if not exists usuarios_sucursales_negocio_idx on usuarios_sucursales (negocio_id);

-- 3. Funciones en esquema plataforma para resolver matriz y sucursales de la empresa
create or replace function plataforma.empresa_raiz(p_negocio_id uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(matriz_id, id) from negocios where id = p_negocio_id;
$$;

create or replace function plataforma.buscar_sucursales_negocio(p_negocio_id uuid)
returns table (
  id uuid,
  nombre text,
  ubicacion text,
  telefono text,
  matriz_id uuid,
  creado_en timestamptz
)
language sql stable security definer set search_path = public, pg_temp as $$
  with raiz as (
    select coalesce(matriz_id, id) as r_id from negocios where id = p_negocio_id
  )
  select n.id, n.nombre, n.ubicacion, n.telefono, n.matriz_id, n.creado_en
  from negocios n, raiz
  where n.id = raiz.r_id or n.matriz_id = raiz.r_id
  order by (n.matriz_id is not null), n.creado_en;
$$;

-- 4. Actualizar políticas de Row Level Security
drop policy if exists aislamiento_negocio on negocios;
create policy aislamiento_negocio on negocios
  using (coalesce(matriz_id, id) = plataforma.empresa_raiz(app_negocio()))
  with check (coalesce(matriz_id, id) = plataforma.empresa_raiz(app_negocio()));

drop policy if exists aislamiento_negocio on usuarios;
create policy aislamiento_negocio on usuarios
  using (
    negocio_id = app_negocio()
    or id in (select usuario_id from usuarios_sucursales where negocio_id = app_negocio())
  )
  with check (negocio_id = app_negocio());

alter table usuarios_sucursales enable row level security;
alter table usuarios_sucursales force row level security;
drop policy if exists aislamiento_negocio on usuarios_sucursales;
create policy aislamiento_negocio on usuarios_sucursales
  using (negocio_id = app_negocio())
  with check (negocio_id = app_negocio());

-- 5. Permisos para los roles de base de datos
grant execute on function plataforma.empresa_raiz(uuid) to mc_app, mc_plataforma;
grant execute on function plataforma.buscar_sucursales_negocio(uuid) to mc_app, mc_plataforma;
grant select, insert, update, delete on usuarios_sucursales to mc_app, mc_plataforma;
grant insert on negocios to mc_app;
