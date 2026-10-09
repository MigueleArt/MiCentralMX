/**
 * Estado de conexión: "en línea" exige navegador conectado y servidor alcanzable.
 * Lo alimentan los eventos del navegador y el resultado de cada llamada a la API.
 */
import { useSyncExternalStore } from 'react';

export interface EstadoConectividad {
  navegador: boolean;
  /** null: todavía no se sabe; false: la última llamada no llegó al servidor. */
  servidor: boolean | null;
}

const enNavegador = typeof navigator !== 'undefined';
let estado: EstadoConectividad = { navegador: enNavegador ? navigator.onLine : true, servidor: null };
const oyentes = new Set<() => void>();

function emitir(siguiente: EstadoConectividad) {
  if (siguiente.navegador === estado.navegador && siguiente.servidor === estado.servidor) return;
  estado = siguiente;
  oyentes.forEach((o) => o());
}

export const marcarServidorAlcanzable = () => emitir({ ...estado, servidor: true });
export const marcarServidorInalcanzable = () => emitir({ ...estado, servidor: false });

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => emitir({ navegador: true, servidor: null }));
  window.addEventListener('offline', () => emitir({ navegador: false, servidor: false }));
}

export const leerConectividad = () => estado;
export const estaEnLinea = (e: EstadoConectividad = estado) => e.navegador && e.servidor !== false;

export function suscribirConectividad(oyente: () => void) {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export function useConectividad() {
  const e = useSyncExternalStore(suscribirConectividad, leerConectividad, leerConectividad);
  return { ...e, enLinea: estaEnLinea(e) };
}
