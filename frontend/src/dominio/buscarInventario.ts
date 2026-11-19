import type { ProductoVista } from './consultas';
import { coincide } from '../componentes/Formulario';

export type FiltroInventario = 'todos' | 'bajo' | 'sin';

/** Muestra únicamente las clasificaciones que cumplen búsqueda y estado. */
export function buscarInventario(catalogo: ProductoVista[], consulta: string, filtro: FiltroInventario): ProductoVista[] {
  return catalogo.map((p) => ({
    ...p,
    clasificaciones: p.clasificaciones.filter((c) =>
      coincide(`${p.producto.nombre} ${c.clasificacion.nombre}`, consulta) &&
      (filtro === 'todos' || (filtro === 'bajo' ? c.bajo : c.sinExistencia)),
    ),
  })).filter((p) => p.clasificaciones.length > 0);
}
