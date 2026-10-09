/** Dato inválido del formulario; `campo` permite marcar el control correspondiente. */
export class ErrorValidacion extends Error {
  constructor(
    mensaje: string,
    public readonly campo?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorValidacion';
  }
}

/**
 * IndexedDB no pudo guardar (espacio lleno, almacenamiento bloqueado).
 * Es el único caso en que guardar falla en el dispositivo (decisiones técnicas §2.3).
 */
export class ErrorAlmacenamiento extends Error {
  constructor(public readonly causa: unknown) {
    super('No se pudo guardar en este dispositivo.');
    this.name = 'ErrorAlmacenamiento';
  }
}

/** Envuelve fallas de Dexie para distinguirlas de errores de validación o sesión. */
export async function conAlmacenamiento<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof Error && ['ErrorValidacion', 'ErrorSesion'].includes(e.name)) throw e;
    throw new ErrorAlmacenamiento(e);
  }
}
