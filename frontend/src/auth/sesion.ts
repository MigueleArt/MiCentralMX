/**
 * Sesión del dispositivo (decisiones técnicas §4.3):
 * - Inicio de sesión solo en línea.
 * - Ventana offline de 24 h (configurable) desde el último contacto con el servidor;
 *   al vencer, la app queda en solo lectura y conserva lo pendiente.
 * - Un usuario por dispositivo sin conexión; no se cierra sesión con operaciones pendientes.
 */
import { api, ErrorRed, fijarToken, refrescarToken } from '../api/cliente';
import type { RespuestaLogin, RespuestaRegistroDispositivo } from '@micentralmx/shared/api';
import type { Permiso } from '@micentralmx/shared/permisos';
import type { UsuarioSesion } from '@micentralmx/shared/entidades';
import { db, type DispositivoLocal, type SesionLocal } from '../db/db';
import { ahoraIso } from '../lib/fechas';

export class ErrorSesion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorSesion';
  }
}

export const tienePermiso = (u: Pick<UsuarioSesion, 'permisos'> | null | undefined, p: Permiso) =>
  !!u?.permisos.includes(p);

export interface EstadoVentana {
  soloLectura: boolean;
  /** Momento en que vence la ventana offline. */
  venceEn: Date;
}

export function estadoVentana(sesion: SesionLocal, ultimoContacto: string | undefined, ahora = Date.now()): EstadoVentana {
  const base = new Date(ultimoContacto ?? sesion.iniciadaEn).getTime();
  const venceEn = new Date(base + sesion.configuracion.ventanaOfflineHoras * 3_600_000);
  return { soloLectura: ahora > venceEn.getTime(), venceEn };
}

/** Operaciones que todavía no llegan al servidor. */
export const contarPendientes = () => db.operaciones.where('estado').anyOf('pendiente', 'enviando').count();

/** Sesión y dispositivo listos para registrar una operación; si no, explica por qué. */
export async function exigirOperable(): Promise<{ sesion: SesionLocal; dispositivo: DispositivoLocal }> {
  const [sesion, dispositivo, ultimoContacto] = await Promise.all([
    db.leerMeta('sesion'),
    db.leerMeta('dispositivo'),
    db.leerMeta('ultimoContacto'),
  ]);
  if (!sesion || !dispositivo) throw new ErrorSesion('Inicia sesión para registrar operaciones.');
  if (estadoVentana(sesion, ultimoContacto).soloLectura) {
    throw new ErrorSesion('Pasaron más de 24 horas sin conexión. Conéctate para seguir registrando; lo pendiente se conserva.');
  }
  return { sesion, dispositivo };
}

async function registrarDispositivo(negocioId: string): Promise<void> {
  const r = await api<RespuestaRegistroDispositivo>('POST', '/dispositivos', {
    nombre: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : 'dispositivo',
  });
  await db.transaction('rw', db.meta, db.bloquesFolio, async () => {
    await db.guardarMeta('dispositivo', {
      id: r.dispositivo_id,
      codigo: r.codigo,
      negocioId,
      provisionales: { venta: 0, compra: 0 },
    });
    await db.bloquesFolio.bulkPut(r.bloques.map((b) => ({ ...b, siguiente: b.desde })));
  });
}

export async function iniciarSesion(usuario: string, contrasena: string): Promise<SesionLocal> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new ErrorSesion('Necesitas Internet para iniciar sesión en este dispositivo.');
  }
  let r: RespuestaLogin;
  try {
    r = await api<RespuestaLogin>('POST', '/auth/login', { usuario, contrasena });
  } catch (e) {
    if (e instanceof ErrorRed) throw new ErrorSesion('Necesitas Internet para iniciar sesión en este dispositivo.');
    throw e;
  }

  const [anterior, dispositivo, pendientes] = await Promise.all([
    db.leerMeta('sesion'),
    db.leerMeta('dispositivo'),
    contarPendientes(),
  ]);
  if (pendientes > 0 && anterior && anterior.usuario.id !== r.usuario.id) {
    throw new ErrorSesion(
      `${anterior.usuario.nombre} tiene operaciones sin sincronizar en este dispositivo. Sincroniza con su sesión antes de cambiar de usuario.`,
    );
  }
  if (dispositivo && dispositivo.negocioId !== r.negocio.id) {
    if (pendientes > 0) throw new ErrorSesion('Este dispositivo tiene operaciones pendientes de otro negocio.');
    // Los datos de cada negocio quedan separados: se vacía la base local antes de cambiar.
    await db.transaction('rw', [db.meta, ...db.tablasNegocio], async () => {
      await Promise.all(db.tablasNegocio.map((t) => t.clear()));
      await db.meta.clear();
    });
  }

  fijarToken(r.access_token);
  const sesion: SesionLocal = {
    usuario: r.usuario,
    negocio: r.negocio,
    configuracion: r.configuracion,
    iniciadaEn: ahoraIso(),
  };
  await db.guardarMeta('sesion', sesion);
  await db.guardarMeta('ultimoContacto', ahoraIso());
  if (!(await db.leerMeta('dispositivo'))) await registrarDispositivo(r.negocio.id);
  return sesion;
}

/** Al abrir la app con sesión guardada: intenta recuperar el access token si hay servidor. */
export async function restaurarSesion(): Promise<void> {
  if (!(await db.leerMeta('sesion'))) return;
  try {
    await refrescarToken();
  } catch {
    // Sin conexión: se trabaja dentro de la ventana offline.
  }
}

export async function cerrarSesion(): Promise<void> {
  const pendientes = await contarPendientes();
  if (pendientes > 0) {
    throw new ErrorSesion(
      pendientes === 1
        ? 'Hay 1 operación sin sincronizar. Sincroniza antes de cerrar sesión.'
        : `Hay ${pendientes} operaciones sin sincronizar. Sincroniza antes de cerrar sesión.`,
    );
  }
  try {
    await api('POST', '/auth/logout', {});
  } catch {
    // Si no hay servidor, la cookie expira sola; la sesión local se cierra igual.
  }
  fijarToken(null);
  await db.borrarMeta('sesion');
}
