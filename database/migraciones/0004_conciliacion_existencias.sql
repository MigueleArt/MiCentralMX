-- Conciliación nocturna (decisiones técnicas §4.4): la existencia guardada debe ser igual a la suma
-- de los movimientos de inventario (el historial es la fuente de verdad). Si difiere, se abre una alerta.

create table alertas_inventario (
  id uuid primary key default uuidv7(),
  negocio_id uuid not null references negocios (id),
  clasificacion_id uuid not null references clasificaciones (id),
  existencia numeric(12, 3) not null,
  suma_movimientos numeric(12, 3) not null,
  detectada_en timestamptz not null default now(),
  -- corregida: la existencia se igualó al historial; coincide: se cerró sola porque ya cuadraba.
  resolucion text check (resolucion in ('corregida', 'coincide')),
  resuelta_por uuid references usuarios (id),
  resuelta_en timestamptz
);
-- Una sola alerta abierta por clasificación.
create unique index alertas_inventario_abierta on alertas_inventario (clasificacion_id) where resuelta_en is null;

alter table alertas_inventario enable row level security;
alter table alertas_inventario force row level security;
create policy aislamiento_negocio on alertas_inventario
  using (negocio_id = app_negocio()) with check (negocio_id = app_negocio());

grant select, insert, update on alertas_inventario to mc_app, mc_plataforma;

-- SECURITY INVOKER: con mc_app (RLS) concilia solo el negocio de la solicitud;
-- la tarea nocturna la ejecuta con mc_plataforma y abarca todos los negocios.
create function conciliar_existencias() returns table (abiertas integer, cerradas integer)
language plpgsql as $$
declare
  v_abiertas integer;
  v_cerradas integer;
begin
  with suma as (
    select clasificacion_id, sum(delta) as total from movimientos_inventario group by clasificacion_id
  ),
  diferencias as (
    select c.id as clasificacion_id, c.negocio_id, coalesce(e.cantidad, 0) as existencia, coalesce(s.total, 0) as suma
    from clasificaciones c
    left join existencias e on e.clasificacion_id = c.id
    left join suma s on s.clasificacion_id = c.id
    where coalesce(e.cantidad, 0) <> coalesce(s.total, 0)
  ),
  insertadas as (
    insert into alertas_inventario (negocio_id, clasificacion_id, existencia, suma_movimientos)
    select negocio_id, clasificacion_id, existencia, suma from diferencias
    on conflict (clasificacion_id) where resuelta_en is null
    do update set existencia = excluded.existencia, suma_movimientos = excluded.suma_movimientos, detectada_en = now()
    returning 1
  )
  select count(*) into v_abiertas from insertadas;

  -- Cierra las que ya cuadran (por ejemplo, tras un ajuste).
  with suma as (
    select clasificacion_id, sum(delta) as total from movimientos_inventario group by clasificacion_id
  ),
  cerradas as (
    update alertas_inventario a
    set resolucion = 'coincide', resuelta_en = now()
    from existencias e
    left join suma s on s.clasificacion_id = e.clasificacion_id
    where a.resuelta_en is null
      and e.clasificacion_id = a.clasificacion_id
      and e.cantidad = coalesce(s.total, 0)
    returning 1
  )
  select count(*) into v_cerradas from cerradas;

  return query select v_abiertas, v_cerradas;
end
$$;

grant execute on function conciliar_existencias() to mc_app, mc_plataforma;
