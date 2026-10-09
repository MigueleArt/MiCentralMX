/** Lecturas reactivas de Dexie (useLiveQuery) para las pantallas que funcionan sin conexión. */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { catalogo, clientesVista, deudasVista, ventasVista, ventaVista } from '../dominio/consultas';

export const useCatalogo = (incluirArchivados = false) => useLiveQuery(() => catalogo(incluirArchivados), [incluirArchivados]);
export const useVentas = () => useLiveQuery(ventasVista);
export const useVenta = (id: string | undefined) => useLiveQuery(() => (id ? ventaVista(id) : null), [id]);
export const useDeudas = () => useLiveQuery(deudasVista);
export const useClientes = () => useLiveQuery(clientesVista);
export const useProveedores = () =>
  useLiveQuery(async () => (await db.proveedores.toArray()).filter((p) => !p.archivadoEn).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
export const useUnidades = () => useLiveQuery(() => db.unidades.toArray());
