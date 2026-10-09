/**
 * Permisos como acciones, agrupados en roles editables por el negocio
 * (propuesta §9 y decisiones técnicas §2 y §9). La API valida siempre;
 * aquí solo se usan para ocultar o deshabilitar lo que el usuario no puede hacer.
 */
export const PERMISOS = {
  'ventas.crear': 'Registrar ventas',
  'ventas.modificar_precio': 'Cambiar el precio en una venta',
  'ventas.vender_sin_existencia': 'Vender sin existencia suficiente',
  'ventas.cancelar': 'Cancelar ventas',
  'ventas.confirmar_transferencia': 'Confirmar transferencias',
  'pagos.registrar': 'Registrar pagos de clientes',
  'compras.crear': 'Registrar compras',
  'inventario.ver': 'Consultar inventario',
  'inventario.merma': 'Registrar mermas',
  'inventario.ajustar': 'Ajustar inventario',
  'catalogo.editar': 'Agregar y editar productos',
  'catalogo.editar_precios': 'Cambiar precios',
  'clientes.crear': 'Agregar clientes',
  'clientes.editar': 'Editar clientes',
  'proveedores.gestionar': 'Agregar y editar proveedores',
  'dinero.registrar': 'Registrar ingresos y egresos',
  'reportes.ver': 'Ver reportes',
  'historial.ver': 'Ver historial',
  'usuarios.gestionar': 'Administrar usuarios',
  'revisiones.resolver': 'Resolver operaciones en revisión',
  'configuracion.editar': 'Cambiar la configuración del negocio',
} as const;

export type Permiso = keyof typeof PERMISOS;
export const TODOS_LOS_PERMISOS = Object.keys(PERMISOS) as Permiso[];

/** Roles base del negocio. "Superadministrador" es de plataforma y no existe aquí. */
export type RolBase = 'dueno' | 'administrador' | 'trabajador';

export const ROLES_BASE: Record<RolBase, { nombre: string; permisos: Permiso[] }> = {
  dueno: { nombre: 'Dueño', permisos: TODOS_LOS_PERMISOS },
  administrador: { nombre: 'Administrador', permisos: TODOS_LOS_PERMISOS },
  trabajador: {
    nombre: 'Trabajador',
    permisos: ['ventas.crear', 'pagos.registrar', 'inventario.ver', 'clientes.crear'],
  },
};
