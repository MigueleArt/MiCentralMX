import { useSyncExternalStore } from 'react';

/** Teléfono (<768), tablet (768-1279) o PC (>=1280), como en el prototipo. */
export type Formato = 'telefono' | 'tablet' | 'pc';

const consultaTablet = '(min-width: 768px)';
const consultaPc = '(min-width: 1280px)';

function leer(): Formato {
  if (typeof window === 'undefined') return 'telefono';
  if (window.matchMedia(consultaPc).matches) return 'pc';
  if (window.matchMedia(consultaTablet).matches) return 'tablet';
  return 'telefono';
}

function suscribir(f: () => void) {
  const listas = [window.matchMedia(consultaTablet), window.matchMedia(consultaPc)];
  listas.forEach((l) => l.addEventListener('change', f));
  return () => listas.forEach((l) => l.removeEventListener('change', f));
}

export const useFormato = () => useSyncExternalStore(suscribir, leer, () => 'telefono' as Formato);
