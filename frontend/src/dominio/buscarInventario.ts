import type { ProductoVista } from './consultas';
import { coincideTokens } from './buscarProductos';

export type FiltroInventario = 'todos' | 'bajo' | 'sin';

/** Muestra únicamente las clasificaciones que cumplen búsqueda y estado. */
export function buscarInventario(catalogo: ProductoVista[], consulta: string, filtro: FiltroInventario): ProductoVista[] {
  return catalogo.map((p) => ({
    ...p,
    clasificaciones: p.clasificaciones.filter((c) =>
      coincideTokens(`${p.producto.nombre} ${c.clasificacion.nombre} ${p.unidad.nombre} ${p.unidad.plural}`, consulta) &&
      (filtro === 'todos' || (filtro === 'bajo' ? c.bajo : c.sinExistencia)),
    ),
  })).filter((p) => p.clasificaciones.length > 0);
}
