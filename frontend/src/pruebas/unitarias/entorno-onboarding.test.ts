import { describe, expect, it } from 'vitest';
import { esPwaInstaladaMovil, type EntornoPwa } from '../../onboarding/entorno';

const entorno = (cambios: Partial<EntornoPwa> = {}): EntornoPwa => ({
  modoIndependiente: true,
  iosIndependiente: false,
  agenteMovil: true,
  punteroTactil: true,
  anchoPantalla: 390,
  altoPantalla: 844,
  ...cambios,
});

describe('entorno permitido para el onboarding', () => {
  it('acepta una PWA instalada en un dispositivo móvil', () => {
    expect(esPwaInstaladaMovil(entorno())).toBe(true);
  });

  it('rechaza el navegador móvil cuando la PWA no está instalada', () => {
    expect(esPwaInstaladaMovil(entorno({ modoIndependiente: false }))).toBe(false);
  });

  it('rechaza una PWA instalada en escritorio', () => {
    expect(esPwaInstaladaMovil(entorno({ agenteMovil: false, punteroTactil: false, anchoPantalla: 1920, altoPantalla: 1080 }))).toBe(false);
  });

  it('reconoce el modo independiente de iOS', () => {
    expect(esPwaInstaladaMovil(entorno({ modoIndependiente: false, iosIndependiente: true }))).toBe(true);
  });
});
