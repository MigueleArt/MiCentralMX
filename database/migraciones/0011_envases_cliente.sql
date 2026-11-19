-- Seguimiento de cajas/taras retornables pendientes por cliente.
create table movimientos_envase (
  id uuid primary key,
  negocio_id uuid not null references negocios (id),
  cliente_id uuid not null references clientes (id),
  cliente_nombre text not null,
  envase text not null check (length(trim(envase)) between 1 and 60),
  tipo text not null check (tipo in ('entrega', 'devolucion', 'saldo_inicial', 'ajuste')),
  cantidad numeric(12, 3) not null check (cantidad >= 0),
  direccion text check (direccion is null or direccion in ('aumenta', 'reduce')),
  nota text,
  venta_id uuid references ventas (id),
  usuario_id uuid not null references usuarios (id),
  usuario_nombre text not null,
  creado_en_dispositivo timestamptz not null,
  tx_id xid8 not null default pg_current_xact_id(),
  check ((tipo = 'ajuste' and direccion is not null and cantidad > 0) or (tipo <> 'ajuste' and direccion is null)),
  check ((tipo = 'saldo_inicial') or cantidad > 0),
  check (cantidad = trunc(cantidad)),
  check (tipo <> 'ajuste' or length(trim(coalesce(nota, ''))) > 0)
);

create index movimientos_envase_negocio_cliente_fecha
  on movimientos_envase (negocio_id, cliente_id, creado_en_dispositivo desc);
create index movimientos_envase_negocio_fecha
  on movimientos_envase (negocio_id, creado_en_dispositivo desc);
create unique index movimientos_envase_saldo_inicial_unico
  on movimientos_envase (negocio_id, cliente_id, lower(envase))
  where tipo = 'saldo_inicial';
create trigger movimientos_envase_tx before update on movimientos_envase for each row execute function marcar_tx();
create index movimientos_envase_tx_idx on movimientos_envase (negocio_id, tx_id);

alter table movimientos_envase enable row level security;
alter table movimientos_envase force row level security;
create policy aislamiento_negocio on movimientos_envase
  using (negocio_id = app_negocio()) with check (negocio_id = app_negocio());
grant select, insert on movimientos_envase to mc_app;
grant select, insert, update, delete on movimientos_envase to mc_plataforma;

-- Los roles base pueden consultar y registrar movimientos. El servidor valida cada escritura.
update roles
set permisos = array_append(permisos, 'envases.gestionar')
where base in ('dueno', 'administrador', 'trabajador')
  and not ('envases.gestionar' = any (permisos));

update roles
set permisos = array_append(permisos, 'envases.ajustar')
where base in ('dueno', 'administrador')
  and not ('envases.ajustar' = any (permisos));
