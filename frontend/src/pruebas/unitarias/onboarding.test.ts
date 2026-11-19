import { describe, expect, it } from 'vitest';
import { VERSION_TERMINOS, claveOnboarding, guardarOnboarding, leerOnboarding, type DatosOnboarding } from '../../onboarding/estado';

class Memoria {
  datos = new Map<string, string>();
  getItem(clave: string) { return this.datos.get(clave) ?? null; }
  setItem(clave: string, valor: string) { this.datos.set(clave, valor); }
}

const datos = (negocioId = 'negocio-1'): DatosOnboarding => ({
  version: 1,
  negocioId,
  objetivos: ['ventas', 'inventario'],
  mercancias: ['Frutas'],
  descripcionMercancias: 'Jitomate y aguacate',
  terminosVersion: VERSION_TERMINOS,
  completadoEn: '2026-11-18T12:00:00.000Z',
});

describe('onboarding de primera entrada', () => {
  it('guarda y recupera la configuración por negocio', () => {
    const memoria = new Memoria();
    expect(guardarOnboarding(memoria, datos())).toBe(true);
    expect(leerOnboarding(memoria, 'negocio-1')).toEqual(datos());
    expect(leerOnboarding(memoria, 'otro-negocio')).toBeNull();
  });

  it('vuelve a solicitar aceptación si cambia la versión de términos', () => {
    const memoria = new Memoria();
    memoria.setItem(claveOnboarding('negocio-1'), JSON.stringify({ ...datos(), terminosVersion: 'anterior' }));
    expect(leerOnboarding(memoria, 'negocio-1')).toBeNull();
  });

  it('ignora datos dañados en vez de bloquear la aplicación', () => {
    const memoria = new Memoria();
    memoria.setItem(claveOnboarding('negocio-1'), '{no-es-json');
    expect(leerOnboarding(memoria, 'negocio-1')).toBeNull();
  });
});
