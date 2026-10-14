-- MiCentralMX · esquema inicial
-- Multi-negocio con Row Level Security (propuesta §6.1, decisiones técnicas §4.1),
-- inventario como historial de movimientos (§6.2), importes NUMERIC (§6.4),
-- idempotencia de sincronización (§7.1) y cursor de bajada por xid8 (§4.2).
-- Se ejecuta como mc_owner.

-- ── Utilidades ──────────────────────────────────────────────────────────────

-- Negocio de la solicitud: lo fija la API con set_config('app.negocio_id', …, true).
-- Si no se fijó, devuelve null y ninguna política deja ver filas.
create function app_negocio() returns uuid
language sql stable as $$
  select nullif(current_setting('app.negocio_id', true), '')::uuid
$$;

-- Marca cada inserción y actualización con la transacción que la hizo (cursor de bajada).
create function marcar_tx() returns trigger
language plpgsql as $$
begin
  new.tx_id := pg_current_xact_id();
  return new;
end
$$;

-- ── Negocio y acceso ────────────────────────────────────────────────────────

create table negocios (
  id uuid primary key,
  nombre text not null check (length(trim(nombre)) > 0),
  ubicacion text,
  ventana_offline_horas integer not null default 24 check (ventana_offline_horas between 1 and 72),
  plazo_credito_dias integer not null default 7 check (plazo_credito_dias between 1 and 120),
  creado_en timestamptz not null default now()
);

create table roles (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  nombre text not null,
  base text check (base in ('dueno', 'administrador', 'trabajador')),
  permisos text[] not null default '{}',
  editable boolean not null default true,
  unique (negocio_id, nombre)
);

create table usuarios (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  nombre text not null,
  usuario text not null,
  contrasena_hash text not null,
  rol_id uuid not null references roles (id),
  activo boolean not null default true,
  ultima_actividad timestamptz,
  creado_en timestamptz not null default now()
);
-- El login es global: el usuario aún no sabe a qué negocio pertenece al iniciar sesión.
create unique index usuarios_login_unico on usuarios (lower(usuario));

create table sesiones_refresh (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  usuario_id uuid not null references usuarios (id),
  token_hash text not null unique,
  expira_en timestamptz not null,
  revocado_en timestamptz,
  creado_en timestamptz not null default now()
);

create table dispositivos (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  usuario_id uuid not null references usuarios (id),
  codigo text not null,
  nombre text,
  creado_en timestamptz not null default now(),
  unique (negocio_id, codigo)
);

-- Contadores por negocio: folios de venta y compra, código de dispositivo.
create table contadores (
  negocio_id uuid not null references negocios (id),
  clave text not null,
  valor bigint not null,
  primary key (negocio_id, clave)
);

create table bloques_folio (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  dispositivo_id uuid not null references dispositivos (id),
  tipo text not null check (tipo in ('venta', 'compra')),
  desde bigint not null,
  hasta bigint not null check (hasta >= desde),
  creado_en timestamptz not null default now()
);
create index bloques_folio_dispositivo on bloques_folio (negocio_id, dispositivo_id, tipo);

-- ── Catálogo ────────────────────────────────────────────────────────────────

create table unidades (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  nombre text not null,
  plural text not null,
  permite_decimales boolean not null default false,
  archivado_en timestamptz,
  tx_id xid8 not null default pg_current_xact_id(),
  unique (negocio_id, nombre)
);

create table productos (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  nombre text not null check (length(trim(nombre)) > 0),
  unidad_id uuid not null references unidades (id),
  umbral_bajo numeric(12, 3) not null default 0 check (umbral_bajo >= 0),
  archivado_en timestamptz,
  tx_id xid8 not null default pg_current_xact_id()
);

create table clasificaciones (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  producto_id uuid not null references productos (id),
  nombre text not null,
  precio numeric(12, 2) not null check (precio >= 0),
  ultimo_costo numeric(12, 2),
  orden integer not null default 0,
  archivado_en timestamptz,
  tx_id xid8 not null default pg_current_xact_id()
);

-- Existencia calculada; se actualiza en la misma transacción que cada movimiento.
create table existencias (
  clasificacion_id uuid primary key references clasificaciones (id),
  negocio_id uuid not null references negocios (id),
  cantidad numeric(12, 3) not null default 0,
  tx_id xid8 not null default pg_current_xact_id()
);

create table clientes (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  nombre text not null,
  telefono text,
  ubicacion text,
  plazo_dias integer check (plazo_dias between 1 and 120),
  saldo_a_favor numeric(12, 2) not null default 0,
  creado_en timestamptz not null default now(),
  archivado_en timestamptz,
  requiere_revision boolean not null default false,
  tx_id xid8 not null default pg_current_xact_id()
);
create index clientes_telefono on clientes (negocio_id, regexp_replace(coalesce(telefono, ''), '\D', '', 'g'));

create table proveedores (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  nombre text not null,
  telefono text,
  productos text not null default '',
  archivado_en timestamptz,
  tx_id xid8 not null default pg_current_xact_id()
);

-- ── Operaciones ─────────────────────────────────────────────────────────────

create table ventas (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  folio bigint not null,
  folio_provisional text,
  cliente_id uuid references clientes (id),
  cliente_nombre text,
  forma_pago text not null check (forma_pago in ('efectivo', 'transferencia', 'credito')),
  estado text not null check (estado in ('completada', 'por_confirmar', 'a_credito', 'cancelada')),
  total numeric(12, 2) not null check (total >= 0),
  pagado numeric(12, 2) not null default 0,
  vence_el date,
  usuario_id uuid not null references usuarios (id),
  usuario_nombre text not null,
  dispositivo_id uuid references dispositivos (id),
  creado_en_dispositivo timestamptz not null,
  recibido_en_servidor timestamptz not null default now(),
  requiere_revision boolean not null default false,
  motivo_revision text,
  cancelada_en timestamptz,
  tx_id xid8 not null default pg_current_xact_id(),
  unique (negocio_id, folio),
  check (forma_pago <> 'credito' or (cliente_id is not null and vence_el is not null))
);
create index ventas_fecha on ventas (negocio_id, creado_en_dispositivo);

-- Cada renglón conserva precio aplicado, clasificación, unidad y cantidad (propuesta §6.5).
create table venta_renglones (
  venta_id uuid not null references ventas (id),
  linea integer not null,
  negocio_id uuid not null references negocios (id),
  clasificacion_id uuid not null references clasificaciones (id),
  producto_id uuid not null references productos (id),
  producto_nombre text not null,
  clasificacion_nombre text not null,
  unidad_nombre text not null,
  unidad_plural text not null,
  cantidad numeric(12, 3) not null check (cantidad > 0),
  precio numeric(12, 2) not null check (precio >= 0),
  precio_referencia numeric(12, 2) not null,
  importe numeric(12, 2) not null,
  primary key (venta_id, linea)
);

create table pagos (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  cliente_id uuid not null references clientes (id),
  cliente_nombre text not null,
  monto numeric(12, 2) not null check (monto > 0),
  metodo text not null check (metodo in ('efectivo', 'transferencia', 'otro')),
  nota text,
  excedente numeric(12, 2) not null default 0,
  usuario_id uuid not null references usuarios (id),
  usuario_nombre text not null,
  creado_en_dispositivo timestamptz not null,
  recibido_en_servidor timestamptz not null default now(),
  requiere_revision boolean not null default false,
  tx_id xid8 not null default pg_current_xact_id()
);
create index pagos_cliente on pagos (negocio_id, cliente_id);

create table pago_aplicaciones (
  pago_id uuid not null references pagos (id),
  venta_id uuid not null references ventas (id),
  negocio_id uuid not null references negocios (id),
  monto numeric(12, 2) not null check (monto > 0),
  primary key (pago_id, venta_id)
);

create table compras (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  folio bigint not null,
  folio_provisional text,
  proveedor_id uuid not null references proveedores (id),
  proveedor_nombre text not null,
  total numeric(12, 2) not null,
  forma_pago text not null check (forma_pago in ('contado', 'credito')),
  vence_el date,
  usuario_id uuid not null references usuarios (id),
  usuario_nombre text not null,
  creado_en_dispositivo timestamptz not null,
  recibido_en_servidor timestamptz not null default now(),
  tx_id xid8 not null default pg_current_xact_id(),
  unique (negocio_id, folio)
);

create table compra_renglones (
  compra_id uuid not null references compras (id),
  linea integer not null,
  negocio_id uuid not null references negocios (id),
  clasificacion_id uuid not null references clasificaciones (id),
  producto_id uuid not null references productos (id),
  producto_nombre text not null,
  clasificacion_nombre text not null,
  unidad_nombre text not null,
  unidad_plural text not null,
  cantidad numeric(12, 3) not null check (cantidad > 0),
  costo numeric(12, 2) not null check (costo > 0),
  importe numeric(12, 2) not null,
  primary key (compra_id, linea)
);

-- Historial inmutable: la API no tiene permiso de UPDATE ni DELETE sobre esta tabla.
create table movimientos_inventario (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  clasificacion_id uuid not null references clasificaciones (id),
  producto_id uuid not null references productos (id),
  delta numeric(12, 3) not null check (delta <> 0),
  tipo text not null check (tipo in ('inicial', 'compra', 'venta', 'merma', 'ajuste', 'cancelacion')),
  referencia text,
  motivo text,
  usuario_id uuid references usuarios (id),
  usuario_nombre text not null,
  creado_en timestamptz not null,
  recibido_en_servidor timestamptz not null default now(),
  tx_id xid8 not null default pg_current_xact_id()
);
create index movimientos_clasificacion on movimientos_inventario (negocio_id, clasificacion_id);

create table movimientos_dinero (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  categoria text not null,
  concepto text not null,
  monto numeric(12, 2) not null check (monto > 0),
  metodo text not null check (metodo in ('efectivo', 'transferencia', 'otro')),
  proveedor_id uuid references proveedores (id),
  usuario_id uuid references usuarios (id),
  usuario_nombre text not null,
  creado_en timestamptz not null,
  recibido_en_servidor timestamptz not null default now(),
  tx_id xid8 not null default pg_current_xact_id()
);

-- ── Sincronización y control ────────────────────────────────────────────────

-- Idempotencia: UNIQUE (negocio_id, operacion_id) y el resultado original para reenvíos.
create table operaciones_sync (
  negocio_id uuid not null references negocios (id),
  operacion_id uuid not null,
  tipo text not null,
  hash text not null,
  datos jsonb not null,
  estado text not null check (estado in ('aplicada', 'en_revision', 'rechazada')),
  aplicada boolean not null,
  motivo text,
  resultado jsonb,
  resumen text not null,
  usuario_id uuid references usuarios (id),
  dispositivo_id uuid references dispositivos (id),
  creado_en_dispositivo timestamptz not null,
  recibido_en timestamptz not null default now(),
  -- Resolución por un usuario autorizado (pantalla Revisiones).
  resolucion text check (resolucion in ('aprobada', 'reaplicada', 'descartada')),
  nota_resolucion text,
  resuelta_por uuid references usuarios (id),
  resuelta_en timestamptz,
  primary key (negocio_id, operacion_id)
);
create index operaciones_por_revisar on operaciones_sync (negocio_id, recibido_en)
  where estado <> 'aplicada' and resuelta_en is null;

-- Auditoría: solo inserción.
create table auditoria (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  fecha timestamptz not null default now(),
  usuario_id uuid references usuarios (id),
  usuario_nombre text not null,
  categoria text not null,
  descripcion text not null,
  tabla text,
  registro_id uuid,
  valores_anteriores jsonb,
  valores_nuevos jsonb
);
create index auditoria_fecha on auditoria (negocio_id, fecha desc);

-- ── Cursor de bajada (xid8) ─────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'unidades', 'productos', 'clasificaciones', 'existencias', 'clientes', 'proveedores',
    'ventas', 'pagos', 'compras', 'movimientos_inventario', 'movimientos_dinero'
  ] loop
    execute format('create trigger %I before update on %I for each row execute function marcar_tx()', t || '_tx', t);
    execute format('create index %I on %I (negocio_id, tx_id)', t || '_tx_idx', t);
  end loop;
end
$$;

-- ── Row Level Security ──────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'roles', 'usuarios', 'sesiones_refresh', 'dispositivos', 'contadores', 'bloques_folio',
    'unidades', 'productos', 'clasificaciones', 'existencias', 'clientes', 'proveedores',
    'ventas', 'venta_renglones', 'pagos', 'pago_aplicaciones', 'compras', 'compra_renglones',
    'movimientos_inventario', 'movimientos_dinero', 'operaciones_sync', 'auditoria'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy aislamiento_negocio on %I using (negocio_id = app_negocio()) with check (negocio_id = app_negocio())', t);
  end loop;
end
$$;

alter table negocios enable row level security;
alter table negocios force row level security;
create policy aislamiento_negocio on negocios using (id = app_negocio()) with check (id = app_negocio());

-- ── Login sin conocer el negocio (SECURITY DEFINER, mínimo indispensable) ────

create schema plataforma authorization mc_owner;

create function plataforma.buscar_login(p_login text)
returns table (usuario_id uuid, negocio_id uuid, contrasena_hash text, activo boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.negocio_id, u.contrasena_hash, u.activo
  from usuarios u
  where lower(u.usuario) = lower(trim(p_login))
$$;

create function plataforma.buscar_refresh(p_token_hash text)
returns table (sesion_id uuid, usuario_id uuid, negocio_id uuid, expira_en timestamptz, revocado_en timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.usuario_id, s.negocio_id, s.expira_en, s.revocado_en
  from sesiones_refresh s
  where s.token_hash = p_token_hash
$$;

revoke all on function plataforma.buscar_login(text), plataforma.buscar_refresh(text) from public;

-- ── Permisos de los roles de base de datos ──────────────────────────────────

grant usage on schema plataforma to mc_app, mc_plataforma;
grant execute on function plataforma.buscar_login(text), plataforma.buscar_refresh(text) to mc_app;
grant execute on function app_negocio() to mc_app, mc_plataforma;

grant select, update on negocios to mc_app;
grant select, insert, update on
  roles, usuarios, sesiones_refresh, dispositivos, contadores, unidades, productos, clasificaciones,
  existencias, clientes, proveedores, ventas, pagos, compras, operaciones_sync
  to mc_app;
-- Registros inmutables: solo inserción y lectura.
grant select, insert on
  bloques_folio, venta_renglones, pago_aplicaciones, compra_renglones,
  movimientos_inventario, movimientos_dinero, auditoria
  to mc_app;

grant select, insert, update on all tables in schema public to mc_plataforma;
