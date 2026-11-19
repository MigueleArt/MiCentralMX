export const VERSION_TERMINOS = '1.0';

export interface DatosOnboarding {
  version: 1;
  negocioId: string;
  objetivos: string[];
  mercancias: string[];
  descripcionMercancias: string;
  terminosVersion: string;
  completadoEn: string;
}

interface Almacenamiento {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
}

export const claveOnboarding = (negocioId: string) => `micentralmx:onboarding-pwa:v1:${negocioId}`;

export function leerOnboarding(almacenamiento: Almacenamiento, negocioId: string): DatosOnboarding | null {
  try {
    const texto = almacenamiento.getItem(claveOnboarding(negocioId));
    if (!texto) return null;
    const datos = JSON.parse(texto) as Partial<DatosOnboarding>;
    if (
      datos.version !== 1 ||
      datos.negocioId !== negocioId ||
      !Array.isArray(datos.objetivos) ||
      !Array.isArray(datos.mercancias) ||
      typeof datos.descripcionMercancias !== 'string' ||
      datos.terminosVersion !== VERSION_TERMINOS ||
      typeof datos.completadoEn !== 'string'
    ) {
      return null;
    }
    return datos as DatosOnboarding;
  } catch {
    return null;
  }
}

export function guardarOnboarding(almacenamiento: Almacenamiento, datos: DatosOnboarding): boolean {
  try {
    almacenamiento.setItem(claveOnboarding(datos.negocioId), JSON.stringify(datos));
    return true;
  } catch {
    return false;
  }
}
