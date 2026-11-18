import type { Permiso } from '@micentralmx/shared/permisos';
import { eq } from 'drizzle-orm';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verificarAcceso } from '../auth/tokens';
import { conNegocio, type Tx } from '../db/pool';
import { roles, usuarios } from '../db/esquema';
import { ErrorHttp, prohibido } from './errores';

export interface UsuarioActual {
  id: string;
  negocioId: string;
  nombre: string;
  usuario: string;
  rolId: string;
  rolNombre: string;
  rolBase: string | null;
  permisos: Permiso[];
  activo: boolean;
}

export interface Contexto {
  tx: Tx;
  usuario: UsuarioActual;
  req: Request;
  res: Response;
}

/** Identidad del access token (sin consultar la base). */
export function identidad(req: Request): { usuarioId: string; negocioId: string } {
  const h = req.headers.authorization;
  const claims = h?.startsWith('Bearer ') ? verificarAcceso(h.slice(7)) : null;
  if (!claims) throw new ErrorHttp(401, 'La sesión expiró.', 'sesion_expirada');
  return { usuarioId: claims.sub, negocioId: claims.neg };
}

/** Usuario con su rol vigente: los permisos se revalidan en cada solicitud (propuesta §9). */
export async function cargarUsuario(tx: Tx, usuarioId: string): Promise<UsuarioActual | null> {
  const [fila] = await tx
    .select({ u: usuarios, r: roles })
    .from(usuarios)
    .innerJoin(roles, eq(roles.id, usuarios.rolId))
    .where(eq(usuarios.id, usuarioId));
  if (!fila) return null;
  return {
    id: fila.u.id,
    negocioId: fila.u.negocioId,
    nombre: fila.u.nombre,
    usuario: fila.u.usuario,
    rolId: fila.r.id,
    rolNombre: fila.r.nombre,
    rolBase: fila.r.base,
    permisos: fila.r.permisos as Permiso[],
    activo: fila.u.activo,
  };
}

export const exigir = (u: UsuarioActual, p: Permiso) => {
  if (!u.permisos.includes(p)) throw prohibido();
};

/**
 * Ruta del negocio: valida el token, abre la transacción con el negocio fijado (RLS),
 * carga al usuario activo, comprueba el permiso y responde con lo que devuelva el manejador.
 */
export function rutaNegocio(permiso: Permiso | null, manejador: (c: Contexto) => Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const { usuarioId, negocioId } = identidad(req);
      const r = await conNegocio(negocioId, async (tx) => {
        const usuario = await cargarUsuario(tx, usuarioId);
        if (!usuario || !usuario.activo) throw new ErrorHttp(401, 'Tu usuario ya no tiene acceso.', 'sesion_expirada');
        if (permiso) exigir(usuario, permiso);
        return manejador({ tx, usuario, req, res });
      });
      if (!res.headersSent) res.json(r ?? null);
    })().catch(next);
  };
}

/** Rutas sin sesión (login, refresh) con manejo de errores asíncrono. */
export const asincrona =
  (f: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    f(req, res)
      .then((r) => {
        if (!res.headersSent) res.json(r ?? null);
      })
      .catch(next);
  };
