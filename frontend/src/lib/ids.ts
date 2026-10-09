import { v7 } from 'uuid';

/** Todos los identificadores se generan en la app con UUID v7 (decisiones técnicas §8). */
export const nuevoId = (): string => v7();

/** JSON con llaves ordenadas para que el hash no dependa del orden de propiedades. */
function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(obj[k])}`)
    .join(',')}}`;
}

/** SHA-256 del contenido de una operación; el servidor rechaza un mismo operacion_id con otro hash. */
export async function hashOperacion(tipo: string, datos: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(`${tipo}:${jsonCanonico(datos)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** "Juan Pérez" → "JP" */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase();
}
