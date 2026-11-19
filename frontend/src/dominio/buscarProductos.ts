import type { ProductoVista } from './consultas';

export interface ResultadoBusquedaProducto {
  producto: ProductoVista;
  clasificacion: ProductoVista['clasificaciones'][number];
  puntuacion: number;
}

/** Normaliza texto sin acentos ni mayúsculas y con espacios colapsados. */
export function normalizarTextoBusqueda(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Verifica que todas las palabras de la consulta aparezcan en el texto. */
export function coincideTokens(texto: string | null | undefined, consulta: string): boolean {
  const norm = normalizarTextoBusqueda(texto);
  const tokens = normalizarTextoBusqueda(consulta).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) => norm.includes(t));
}

function calcularPuntuacion(
  prodNombre: string,
  clasNombre: string,
  unidadTexto: string,
  consultaNorm: string,
  tokens: string[],
  conExistencia: boolean,
): number {
  let puntos = 0;
  const prodPalabras = prodNombre.split(/\s+/).filter(Boolean);
  const clasPalabras = clasNombre.split(/\s+/).filter(Boolean);

  if (prodNombre.startsWith(consultaNorm)) {
    puntos += 100;
  }

  for (const t of tokens) {
    if (prodNombre.startsWith(t)) puntos += 80;
    else if (prodPalabras.some((w) => w.startsWith(t))) puntos += 60;
    else if (prodNombre.includes(t)) puntos += 40;

    if (clasNombre.startsWith(t)) puntos += 30;
    else if (clasPalabras.some((w) => w.startsWith(t))) puntos += 22;
    else if (clasNombre.includes(t)) puntos += 15;

    if (unidadTexto.includes(t)) puntos += 10;
  }

  if (conExistencia) puntos += 5;
  return puntos;
}

/** Búsqueda rápida multi-término por producto, clasificación y unidad, ordenada por relevancia. */
export function buscarProductosRapido(
  catalogo: ProductoVista[],
  consulta: string,
  limite = 20,
): ResultadoBusquedaProducto[] {
  const consultaNorm = normalizarTextoBusqueda(consulta);
  const tokens = consultaNorm.split(/\s+/).filter(Boolean);
  const resultados: ResultadoBusquedaProducto[] = [];

  for (const p of catalogo) {
    const prodNorm = normalizarTextoBusqueda(p.producto.nombre);
    const unidadNorm = normalizarTextoBusqueda(`${p.unidad.nombre} ${p.unidad.plural}`);
    for (const c of p.clasificaciones) {
      const clasNorm = normalizarTextoBusqueda(c.clasificacion.nombre);
      const todo = `${prodNorm} ${clasNorm} ${unidadNorm}`;
      if (tokens.length > 0 && !tokens.every((t) => todo.includes(t))) continue;

      const conExistencia = c.existencia.gt(0);
      const puntuacion =
        tokens.length === 0
          ? conExistencia
            ? 10
            : 0
          : calcularPuntuacion(prodNorm, clasNorm, unidadNorm, consultaNorm, tokens, conExistencia);

      resultados.push({ producto: p, clasificacion: c, puntuacion });
    }
  }

  resultados.sort((a, b) => {
    if (b.puntuacion !== a.puntuacion) return b.puntuacion - a.puntuacion;
    const stockA = a.clasificacion.existencia.gt(0) ? 1 : 0;
    const stockB = b.clasificacion.existencia.gt(0) ? 1 : 0;
    if (stockB !== stockA) return stockB - stockA;
    const cmpProd = a.producto.producto.nombre.localeCompare(b.producto.producto.nombre, 'es');
    if (cmpProd !== 0) return cmpProd;
    return a.clasificacion.clasificacion.orden - b.clasificacion.clasificacion.orden;
  });

  return resultados.slice(0, limite);
}
