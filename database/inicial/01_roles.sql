-- Roles de MiCentralMX (decisiones técnicas §4.1). Se ejecuta UNA vez como superusuario,
-- antes de las migraciones. Las contraseñas se leen de variables de entorno:
--   MC_OWNER_PASSWORD, MC_APP_PASSWORD, MC_PLATAFORMA_PASSWORD
-- Docker: lo ejecuta docker-entrypoint-initdb.d. Local:
--   psql -U postgres -d postgres -f database/inicial/01_roles.sql

\getenv mc_owner_password MC_OWNER_PASSWORD
\getenv mc_app_password MC_APP_PASSWORD
\getenv mc_plataforma_password MC_PLATAFORMA_PASSWORD

-- Dueño de las tablas y de las migraciones. BYPASSRLS solo para las funciones
-- SECURITY DEFINER de búsqueda de login; la API nunca se conecta con este rol.
create role mc_owner login bypassrls password :'mc_owner_password';

-- Rol de la API del negocio: todas sus consultas pasan por RLS.
create role mc_app login nobypassrls password :'mc_app_password';

-- Rol del panel de plataforma (superadministrador). Pool separado y solo rutas /api/plataforma.
create role mc_plataforma login bypassrls password :'mc_plataforma_password';

select 'create database micentralmx owner mc_owner encoding ''UTF8'''
where not exists (select 1 from pg_database where datname = 'micentralmx') \gexec

\connect micentralmx
alter schema public owner to mc_owner;
revoke all on schema public from public;
grant usage on schema public to mc_app, mc_plataforma;
