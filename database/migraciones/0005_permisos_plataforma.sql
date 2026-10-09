-- La tarea nocturna (mc_plataforma) depura intentos de login vencidos.
grant select, insert, update, delete on intentos_login to mc_plataforma;

-- Las tablas que se creen en adelante quedan disponibles para el panel de plataforma
-- sin repetir el permiso en cada migración. mc_app sigue recibiendo permisos tabla por tabla.
alter default privileges for role mc_owner in schema public grant select, insert, update on tables to mc_plataforma;
