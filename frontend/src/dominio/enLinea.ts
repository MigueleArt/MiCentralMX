/**
 * Operaciones solo en línea (decisiones técnicas §4.5): catálogo y precios, ajustes,
 * cancelaciones, proveedores, usuarios y configuración. El servidor decide y la bajada
 * actualiza la base local; no pasan por la cola offline.
 */
import { api } from '../api/cliente';
import type { DatosProducto, RolNegocio, SolicitudAjuste, UsuarioNegocio } from '@micentralmx/shared/api';
import type { ConfiguracionNegocio, Producto, Proveedor } from '@micentralmx/shared/entidades';
import { sincronizar } from '../sync/motor';

async function yRefrescar<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  await sincronizar();
  return r;
}

export const crearProducto = (d: DatosProducto) => yRefrescar(api<Producto>('POST', '/productos', d));
export const editarProducto = (id: string, d: DatosProducto) => yRefrescar(api<Producto>('PATCH', `/productos/${id}`, d));
export const archivarProducto = (id: string) => yRefrescar(api<void>('POST', `/productos/${id}/archivar`, {}));

export const ajustarInventario = (d: SolicitudAjuste) =>
  yRefrescar(api<{ delta: string }>('POST', '/inventario/ajustes', d));

export const cancelarVenta = (id: string, motivo: string) => yRefrescar(api<void>('POST', `/ventas/${id}/cancelar`, { motivo }));
export const confirmarTransferencia = (id: string) =>
  yRefrescar(api<void>('POST', `/ventas/${id}/confirmar-transferencia`, {}));

export interface DatosClienteEdicion {
  nombre: string;
  telefono: string | null;
  ubicacion: string | null;
  plazoDias: number | null;
}
export const editarCliente = (id: string, d: DatosClienteEdicion) => yRefrescar(api<void>('PATCH', `/clientes/${id}`, d));

export type DatosProveedor = Pick<Proveedor, 'nombre' | 'telefono' | 'productos'>;
export const crearProveedor = (d: DatosProveedor) => yRefrescar(api<Proveedor>('POST', '/proveedores', d));
export const editarProveedor = (id: string, d: DatosProveedor) => yRefrescar(api<Proveedor>('PATCH', `/proveedores/${id}`, d));

export interface DatosUsuario {
  nombre: string;
  usuario: string;
  rolId: string;
  contrasena?: string;
  activo?: boolean;
}
export const crearUsuario = (d: DatosUsuario) => api<UsuarioNegocio>('POST', '/usuarios', d);
export const editarUsuario = (id: string, d: Partial<DatosUsuario>) => api<UsuarioNegocio>('PATCH', `/usuarios/${id}`, d);
export const editarRol = (id: string, permisos: string[]) => api<RolNegocio>('PUT', `/roles/${id}`, { permisos });

export const guardarConfiguracion = (d: ConfiguracionNegocio & { nombre: string; ubicacion: string | null }) =>
  yRefrescar(api<void>('PATCH', '/configuracion', d));
export const cambiarContrasena = (actual: string, nueva: string) =>
  api<void>('POST', '/auth/cambiar-contrasena', { actual, nueva });
