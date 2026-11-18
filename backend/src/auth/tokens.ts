import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface ClaimsAcceso {
  sub: string;
  neg: string;
}

export const firmarAcceso = (usuarioId: string, negocioId: string) =>
  jwt.sign({ neg: negocioId } satisfies Omit<ClaimsAcceso, 'sub'>, config.jwtSecreto, {
    subject: usuarioId,
    expiresIn: `${config.accessMinutos}m`,
    algorithm: 'HS256',
  });

export function verificarAcceso(token: string): ClaimsAcceso | null {
  try {
    const c = jwt.verify(token, config.jwtSecreto, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    return typeof c.sub === 'string' && typeof c.neg === 'string' ? { sub: c.sub, neg: c.neg } : null;
  } catch {
    return null;
  }
}

/** Refresh token opaco: al cliente va el valor; en la base solo su SHA-256. */
export const nuevoRefresh = () => randomBytes(32).toString('base64url');
export const hashRefresh = (t: string) => createHash('sha256').update(t).digest('hex');

export const hashContrasena = (c: string) => argon2.hash(c, { type: argon2.argon2id });
export const verificarContrasena = (hash: string, c: string) => argon2.verify(hash, c).catch(() => false);

export const COOKIE_REFRESH = 'mc_refresh';
export const opcionesCookie = () => ({
  httpOnly: true,
  secure: config.cookieSegura,
  sameSite: 'strict' as const,
  path: '/api/auth',
  maxAge: config.refreshDias * 86_400_000,
});
