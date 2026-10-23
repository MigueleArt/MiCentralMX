import type { CrearSucursalReq, SucursalResumen } from '@micentralmx/shared/api';
import { api } from './cliente';

/** Lista todas las sucursales vinculadas a la empresa del usuario actual */
export async function listarSucursales(): Promise<SucursalResumen[]> {
  return api<SucursalResumen[]>('GET', '/sucursales');
}

/** Crea una nueva sucursal / bodega para la empresa (solo Dueño) */
export async function crearSucursal(datos: CrearSucursalReq): Promise<SucursalResumen> {
  return api<SucursalResumen>('POST', '/sucursales', datos);
}
