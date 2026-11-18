import { API_BASE, MODO_DEMO } from '../config';
import { db } from '../db/db';
import { ahoraIso } from '../lib/fechas';
import { marcarServidorAlcanzable, marcarServidorInalcanzable } from '../sync/conectividad';

/** El servidor respondió con un error (validación, permisos, regla de negocio). */
export class ErrorApi extends Error {
  constructor(
    public readonly estado: number,
    mensaje: string,
    public readonly codigo?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

/** La solicitud no llegó al servidor. No se interpreta como "sin conexión" en la UI de guardado. */
export class ErrorRed extends Error {
  constructor() {
    super('No se pudo contactar al servidor.');
    this.name = 'ErrorRed';
  }
}

type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
interface RespuestaCruda {
  estado: number;
  datos: unknown;
}
export type Transporte = (metodo: Metodo, ruta: string, cuerpo: unknown, token: string | null) => Promise<RespuestaCruda>;

const transporteHttp: Transporte = async (metodo, ruta, cuerpo, token) => {
  let r: Response;
  try {
    r = await fetch(`${API_BASE}${ruta}`, {
      method: metodo,
      credentials: 'same-origin',
      headers: {
        ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorRed();
  }
  const texto = await r.text();
  let datos: unknown = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = { mensaje: texto };
  }
  return { estado: r.status, datos };
};

declare const __MODO_DEMO__: boolean;

/**
 * En modo demo la API la responde un servidor de prueba local (src/demo), cargado bajo demanda.
 * La constante literal permite que el build normal elimine el import y no empaquete src/demo.
 */
const transporteDemo: Transporte | null = __MODO_DEMO__
  ? async (metodo, ruta, cuerpo, token) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ErrorRed();
      const { manejarSolicitud } = await import('../demo/servidor');
      return manejarSolicitud(metodo, ruta, cuerpo, token);
    }
  : null;

let transporte: Transporte = MODO_DEMO && transporteDemo ? transporteDemo : transporteHttp;
/** Solo para pruebas. */
export const usarTransporte = (t: Transporte) => {
  transporte = t;
};

// El access token vive solo en memoria; el refresh token, en cookie httpOnly.
let accessToken: string | null = null;
export const fijarToken = (t: string | null) => {
  accessToken = t;
};
export const hayToken = () => accessToken !== null;

const oyentesExpiracion = new Set<() => void>();
/** Se dispara cuando el servidor ya no acepta la sesión (refresh rechazado). */
export const alExpirarSesion = (f: () => void) => {
  oyentesExpiracion.add(f);
  return () => oyentesExpiracion.delete(f);
};

async function registrarContacto() {
  marcarServidorAlcanzable();
  try {
    await db.guardarMeta('ultimoContacto', ahoraIso());
  } catch {
    // Si IndexedDB falla aquí, la siguiente escritura de dominio lo reportará.
  }
}

function mensajeDe(datos: unknown, estado: number): [string, string | undefined] {
  if (datos && typeof datos === 'object') {
    const d = datos as { mensaje?: string; message?: string; codigo?: string };
    return [d.mensaje ?? d.message ?? `Error ${estado}`, d.codigo];
  }
  return [`Error ${estado}`, undefined];
}

let refrescando: Promise<boolean> | null = null;
export async function refrescarToken(): Promise<boolean> {
  refrescando ??= (async () => {
    try {
      const r = await transporte('POST', '/auth/refresh', {}, null);
      if (r.estado === 200) {
        accessToken = (r.datos as { access_token: string }).access_token;
        await registrarContacto();
        return true;
      }
      await registrarContacto();
      if (r.estado === 401) oyentesExpiracion.forEach((f) => f());
      return false;
    } catch (e) {
      if (e instanceof ErrorRed) marcarServidorInalcanzable();
      throw e;
    } finally {
      refrescando = null;
    }
  })();
  return refrescando;
}

/** Llamada a la API con renovación automática del access token. */
export async function api<T>(metodo: Metodo, ruta: string, cuerpo?: unknown): Promise<T> {
  const intentar = async () => {
    try {
      return await transporte(metodo, ruta, cuerpo, accessToken);
    } catch (e) {
      if (e instanceof ErrorRed) marcarServidorInalcanzable();
      throw e;
    }
  };
  let r = await intentar();
  if (r.estado === 401 && !ruta.startsWith('/auth/')) {
    if (await refrescarToken()) r = await intentar();
  }
  await registrarContacto();
  if (r.estado >= 200 && r.estado < 300) return r.datos as T;
  const [mensaje, codigo] = mensajeDe(r.datos, r.estado);
  throw new ErrorApi(r.estado, mensaje, codigo);
}

/** Mensaje legible para la UI. No atribuye fallas a la conexión salvo que sea ErrorRed. */
export function mensajeError(e: unknown): string {
  if (e instanceof ErrorRed) return 'No se pudo contactar al servidor. Inténtalo cuando tengas conexión.';
  if (e instanceof Error) return e.message;
  return 'Ocurrió un error inesperado.';
}
