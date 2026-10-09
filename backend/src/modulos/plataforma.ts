/**
 * Panel de plataforma (superadministrador, decisiones técnicas §4.1): pool separado con
 * mc_plataforma y rutas /api/plataforma protegidas por PLATAFORMA_TOKEN. No participa en ventas.
 */
import { ROLES_BASE, type RolBase } from '@micentralmx/shared/permisos';
import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { v7 as uuid } from 'uuid';
import { z } from 'zod';
import { hashContrasena } from '../auth/tokens';
import { config } from '../config';
import { dbPlataforma, type Db } from '../db/pool';
import { negocios, roles, unidades, usuarios } from '../db/esquema';
import { ErrorHttp, conflicto, esUnicidad } from '../http/errores';
import { asincrona } from '../http/ruta';

export const UNIDADES_INICIALES: Array<[string, string, boolean]> = [
  ['caja', 'cajas', false],
  ['kg', 'kg', true],
  ['pieza', 'piezas', false],
  ['costal', 'costales', false],
  ['arpilla', 'arpillas', false],
  ['tara', 'taras', false],
  ['libra', 'libras', true],
];

export interface DatosNegocioNuevo {
  nombre: string;
  ubicacion: string | null;
  dueno: { nombre: string; usuario: string; contrasena: string };
}

/** Crea el negocio con sus roles base, unidades precargadas y el usuario Dueño. */
export async function crearNegocio(db: Db, d: DatosNegocioNuevo) {
  const negocioId = uuid();
  const hash = await hashContrasena(d.dueno.contrasena);
  return db.transaction(async (tx) => {
    await tx.insert(negocios).values({ id: negocioId, nombre: d.nombre, ubicacion: d.ubicacion, ventanaOfflineHoras: 24, plazoCreditoDias: 7 });
    const ids = {} as Record<RolBase, string>;
    for (const base of Object.keys(ROLES_BASE) as RolBase[]) {
      ids[base] = uuid();
      await tx.insert(roles).values({
        id: ids[base],
        negocioId,
        nombre: ROLES_BASE[base].nombre,
        base,
        permisos: [...ROLES_BASE[base].permisos],
        editable: base !== 'dueno',
      });
    }
    await tx.insert(unidades).values(UNIDADES_INICIALES.map(([nombre, plural, permiteDecimales]) => ({ id: uuid(), negocioId, nombre, plural, permiteDecimales })));
    const duenoId = uuid();
    await tx.insert(usuarios).values({ id: duenoId, negocioId, nombre: d.dueno.nombre, usuario: d.dueno.usuario.toLowerCase(), contrasenaHash: hash, rolId: ids.dueno, activo: true });
    return { negocioId, duenoId, roles: ids };
  });
}

function exigirTokenPlataforma(valor: string | undefined) {
  const esperado = config.plataformaToken;
  const ok = !!esperado && !!valor && valor.length === esperado.length && timingSafeEqual(Buffer.from(valor), Buffer.from(esperado));
  if (!ok) throw new ErrorHttp(401, 'Token de plataforma inválido.', 'sin_permiso');
}

export const rutasPlataforma = Router();

rutasPlataforma.post(
  '/negocios',
  asincrona(async (req) => {
    exigirTokenPlataforma(req.header('x-plataforma-token'));
    const d = z
      .object({
        nombre: z.string().trim().min(1).max(120),
        ubicacion: z.string().trim().max(200).nullable().default(null),
        dueno: z.object({ nombre: z.string().trim().min(2).max(120), usuario: z.string().trim().min(3).max(80), contrasena: z.string().min(8).max(200) }),
      })
      .parse(req.body);
    try {
      const r = await crearNegocio(dbPlataforma(), d);
      return { negocio_id: r.negocioId, dueno_id: r.duenoId };
    } catch (e) {
      if (esUnicidad(e)) throw conflicto('Ese usuario ya existe.');
      throw e;
    }
  }),
);
