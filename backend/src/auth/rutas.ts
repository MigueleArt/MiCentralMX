import type { RespuestaLogin } from '@micentralmx/shared/api';
import type { ConfiguracionNegocio, Negocio, UsuarioSesion } from '@micentralmx/shared/entidades';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import { v7 as uuid } from 'uuid';
import { z } from 'zod';
import { config } from '../config';
import { conNegocio, dbApp, type Tx } from '../db/pool';
import { negocios, sesionesRefresh, usuarios } from '../db/esquema';
import { ErrorHttp, invalido } from '../http/errores';
import { asincrona, cargarUsuario, rutaNegocio, type UsuarioActual } from '../http/ruta';
import { registrarAuditoria } from '../lib/auditoria';
import { COOKIE_REFRESH, firmarAcceso, hashContrasena, hashRefresh, nuevoRefresh, opcionesCookie, verificarContrasena } from './tokens';

export const aUsuarioSesion = (u: UsuarioActual): UsuarioSesion => ({
  id: u.id,
  nombre: u.nombre,
  usuario: u.usuario,
  rolId: u.rolId,
  rolNombre: u.rolNombre,
  rolBase: u.rolBase,
  permisos: u.permisos,
});

export async function negocioYConfiguracion(tx: Tx, negocioId: string): Promise<{ negocio: Negocio; configuracion: ConfiguracionNegocio }> {
  const [n] = await tx.select().from(negocios).where(eq(negocios.id, negocioId));
  return {
    negocio: { id: n.id, nombre: n.nombre, ubicacion: n.ubicacion },
    configuracion: { ventanaOfflineHoras: n.ventanaOfflineHoras, plazoCreditoDias: n.plazoCreditoDias },
  };
}

// Limitación de intentos de inicio de sesión (propuesta §9): 5 fallos por usuario e IP cada 15 min.
// Vive en la base para que valga igual con varias instancias de la API.
const MAX_FALLOS = 5;
const VENTANA = sql`interval '15 minutes'`;
/** SHA-256 de "IP|usuario": no se guardan la IP ni el usuario en claro. */
const claveIntento = (req: Request, login: string) => createHash('sha256').update(`${req.ip}|${login.toLowerCase()}`).digest('hex');

async function revisarLimite(clave: string) {
  const { rows } = await dbApp.execute<{ fallos: number }>(
    sql`select fallos from intentos_login where clave_hash = ${clave} and ventana_hasta > now()`,
  );
  if ((rows[0]?.fallos ?? 0) >= MAX_FALLOS) {
    throw new ErrorHttp(429, 'Demasiados intentos. Espera 15 minutos o pide a tu administrador que restablezca tu contraseña.', 'demasiados_intentos');
  }
}

/** Suma un fallo de forma atómica; si la ventana anterior ya venció, empieza una nueva. */
async function anotarFallo(clave: string) {
  await dbApp.execute(sql`
    insert into intentos_login (clave_hash, fallos, ventana_hasta) values (${clave}, 1, now() + ${VENTANA})
    on conflict (clave_hash) do update set
      fallos = case when intentos_login.ventana_hasta <= now() then 1 else intentos_login.fallos + 1 end,
      ventana_hasta = case when intentos_login.ventana_hasta <= now() then now() + ${VENTANA} else intentos_login.ventana_hasta end`);
}

const limpiarIntentos = (clave: string) => dbApp.execute(sql`delete from intentos_login where clave_hash = ${clave}`);

/** Solo pruebas. */
export const reiniciarLimites = () => dbApp.execute(sql`delete from intentos_login`);

async function emitirRefresh(tx: Tx, usuarioId: string, negocioId: string): Promise<string> {
  const token = nuevoRefresh();
  await tx.insert(sesionesRefresh).values({
    id: uuid(),
    negocioId,
    usuarioId,
    tokenHash: hashRefresh(token),
    expiraEn: new Date(Date.now() + config.refreshDias * 86_400_000),
  });
  return token;
}

const esquemaLogin = z.object({ usuario: z.string().trim().min(1).max(80), contrasena: z.string().min(1).max(200) });

export const rutasAuth = Router();

rutasAuth.post(
  '/login',
  asincrona(async (req, res) => {
    const { usuario, contrasena } = esquemaLogin.parse(req.body);
    const clave = claveIntento(req, usuario);
    await revisarLimite(clave);
    // El negocio todavía no se conoce: función SECURITY DEFINER que solo devuelve lo necesario.
    const { rows } = await dbApp.execute<{ usuario_id: string; negocio_id: string; contrasena_hash: string; activo: boolean }>(
      sql`select * from plataforma.buscar_login(${usuario})`,
    );
    const encontrado = rows[0];
    const valida = encontrado ? await verificarContrasena(encontrado.contrasena_hash, contrasena) : false;
    if (!encontrado || !valida) {
      await anotarFallo(clave);
      throw new ErrorHttp(401, 'Usuario o contraseña incorrectos.', 'credenciales');
    }
    if (!encontrado.activo) throw new ErrorHttp(403, 'Tu usuario está suspendido. Habla con el administrador.', 'suspendido');
    await limpiarIntentos(clave);

    const r = await conNegocio(encontrado.negocio_id, async (tx) => {
      const u = (await cargarUsuario(tx, encontrado.usuario_id))!;
      await tx.update(usuarios).set({ ultimaActividad: new Date() }).where(eq(usuarios.id, u.id));
      const refresh = await emitirRefresh(tx, u.id, u.negocioId);
      return { u, refresh, ...(await negocioYConfiguracion(tx, u.negocioId)) };
    });
    res.cookie(COOKIE_REFRESH, r.refresh, opcionesCookie());
    return {
      access_token: firmarAcceso(r.u.id, r.u.negocioId),
      usuario: aUsuarioSesion(r.u),
      negocio: r.negocio,
      configuracion: r.configuracion,
    } satisfies RespuestaLogin;
  }),
);

/** Renueva el access token y rota el refresh token (uno usado no vuelve a servir). */
rutasAuth.post(
  '/refresh',
  asincrona(async (req, res) => {
    const token = req.cookies?.[COOKIE_REFRESH] as string | undefined;
    if (!token) throw new ErrorHttp(401, 'La sesión expiró.', 'sesion_expirada');
    const { rows } = await dbApp.execute<{ sesion_id: string; usuario_id: string; negocio_id: string; expira_en: Date; revocado_en: Date | null }>(
      sql`select * from plataforma.buscar_refresh(${hashRefresh(token)})`,
    );
    const s = rows[0];
    if (!s || s.revocado_en || new Date(s.expira_en).getTime() < Date.now()) {
      res.clearCookie(COOKIE_REFRESH, { path: '/api/auth' });
      throw new ErrorHttp(401, 'La sesión expiró.', 'sesion_expirada');
    }
    const nuevo = await conNegocio(s.negocio_id, async (tx) => {
      const u = await cargarUsuario(tx, s.usuario_id);
      if (!u) throw new ErrorHttp(401, 'La sesión expiró.', 'sesion_expirada');
      await tx.update(sesionesRefresh).set({ revocadoEn: new Date() }).where(eq(sesionesRefresh.id, s.sesion_id));
      // Un usuario suspendido conserva la renovación solo para enviar lo que registró sin conexión;
      // el servidor deja esas operaciones en revisión y las demás rutas lo rechazan.
      return emitirRefresh(tx, u.id, u.negocioId);
    });
    res.cookie(COOKIE_REFRESH, nuevo, opcionesCookie());
    return { access_token: firmarAcceso(s.usuario_id, s.negocio_id) };
  }),
);

rutasAuth.post(
  '/logout',
  asincrona(async (req, res) => {
    const token = req.cookies?.[COOKIE_REFRESH] as string | undefined;
    if (token) {
      const { rows } = await dbApp.execute<{ sesion_id: string; negocio_id: string }>(sql`select * from plataforma.buscar_refresh(${hashRefresh(token)})`);
      if (rows[0]) {
        await conNegocio(rows[0].negocio_id, (tx) =>
          tx.update(sesionesRefresh).set({ revocadoEn: new Date() }).where(and(eq(sesionesRefresh.id, rows[0].sesion_id), isNull(sesionesRefresh.revocadoEn))),
        );
      }
    }
    res.clearCookie(COOKIE_REFRESH, { path: '/api/auth' });
    return null;
  }),
);

const esquemaCambio = z.object({ actual: z.string().min(1), nueva: z.string().min(8, 'mínimo 8 caracteres').max(200) });

rutasAuth.post(
  '/cambiar-contrasena',
  rutaNegocio(null, async ({ tx, usuario, req }) => {
    const { actual, nueva } = esquemaCambio.parse(req.body);
    const [u] = await tx.select({ hash: usuarios.contrasenaHash }).from(usuarios).where(eq(usuarios.id, usuario.id));
    if (!(await verificarContrasena(u.hash, actual))) throw invalido('La contraseña actual no es correcta.');
    await tx.update(usuarios).set({ contrasenaHash: await hashContrasena(nueva) }).where(eq(usuarios.id, usuario.id));
    // Cierra las demás sesiones del usuario; la de este dispositivo sigue activa.
    const actualCookie = req.cookies?.[COOKIE_REFRESH] as string | undefined;
    await tx
      .update(sesionesRefresh)
      .set({ revocadoEn: new Date() })
      .where(and(eq(sesionesRefresh.usuarioId, usuario.id), isNull(sesionesRefresh.revocadoEn), ne(sesionesRefresh.tokenHash, actualCookie ? hashRefresh(actualCookie) : '')));
    await registrarAuditoria(tx, usuario, 'usuarios', `${usuario.nombre} cambió su contraseña`);
    return null;
  }),
);
