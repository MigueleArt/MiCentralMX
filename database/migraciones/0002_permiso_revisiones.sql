-- Permiso nuevo para la pantalla Revisiones. Los negocios creados antes de esta migración
-- lo reciben en sus roles Dueño y Administrador; los negocios nuevos lo traen de ROLES_BASE.
update roles
set permisos = array_append(permisos, 'revisiones.resolver')
where base in ('dueno', 'administrador')
  and not ('revisiones.resolver' = any (permisos));
