-- Límite de intentos de inicio de sesión compartido entre instancias de la API (propuesta §9).
-- La clave es SHA-256 de "IP|usuario": no se guarda la IP ni el usuario en claro (LFPDPPP).
-- No es un dato de un negocio (el negocio se desconoce al iniciar sesión), por eso no lleva RLS.
create table intentos_login (
  clave_hash text primary key,
  fallos integer not null,
  ventana_hasta timestamptz not null
);
create index intentos_login_vencidos on intentos_login (ventana_hasta);

grant select, insert, update, delete on intentos_login to mc_app;
