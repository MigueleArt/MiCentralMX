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
import { negocios, roles, unidades, usuarios, usuariosSucursales } from '../db/esquema';
import { ErrorHttp, conflicto, esUnicidad, noEncontrado } from '../http/errores';
import { asincrona } from '../http/ruta';

export const UNIDADES_INICIALES: Array<[string, string, boolean]> = [
  ['caja', 'cajas', false],
  ['kg', 'kg', true],
  ['pieza', 'piezas', false],
  ['costal', 'costales', false],
  ['arpilla', 'arpillas', false],
  ['tara', 'taras', true],
  ['libra', 'libras', true],
];

export interface DatosNegocioNuevo {
  nombre: string;
  telefono?: string | null;
  ubicacion: string | null;
  dueno: { nombre: string; usuario: string; contrasena: string };
}

/** Crea el negocio con sus roles base, unidades precargadas y el usuario Dueño. */
export async function crearNegocio(db: Db, d: DatosNegocioNuevo) {
  const negocioId = uuid();
  const hash = await hashContrasena(d.dueno.contrasena);
  return db.transaction(async (tx) => {
    await tx.insert(negocios).values({ id: negocioId, nombre: d.nombre, telefono: d.telefono ?? null, ubicacion: d.ubicacion, ventanaOfflineHoras: 24, plazoCreditoDias: 7 });
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

import { eq, desc, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { ventas } from '../db/esquema';

function obtenerTokenPlataforma(req: Request): string | undefined {
  const h = req.header('x-plataforma-token');
  if (h) return h;
  const auth = req.header('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return undefined;
}

export function exigirTokenPlataforma(reqOUValor: Request | string | undefined) {
  const valor = typeof reqOUValor === 'string' || reqOUValor === undefined
    ? reqOUValor
    : obtenerTokenPlataforma(reqOUValor);
  const esperado = config.plataformaToken;
  const ok = !!esperado && !!valor && valor.length === esperado.length && timingSafeEqual(Buffer.from(valor), Buffer.from(esperado));
  if (!ok) throw new ErrorHttp(401, 'Token de plataforma inválido.', 'sin_permiso');
}

export const rutasPlataforma = Router();

/** 1. Verificar credenciales de Superadmin */
rutasPlataforma.post(
  '/auth/verificar',
  asincrona(async (req) => {
    const d = z.object({ token: z.string() }).safeParse(req.body);
    const token = d.success ? d.data.token : obtenerTokenPlataforma(req);
    const esperado = config.plataformaToken;
    const ok = !!esperado && !!token && token.length === esperado.length && timingSafeEqual(Buffer.from(token), Buffer.from(esperado));
    if (!ok) throw new ErrorHttp(401, 'Credenciales de plataforma incorrectas.', 'sin_permiso');
    return { ok: true, mensaje: 'Superadministrador autenticado' };
  }),
);

/** 2. Listar todos los locales / negocios con estadísticas globales */
rutasPlataforma.get(
  '/negocios',
  asincrona(async (req) => {
    exigirTokenPlataforma(req);
    const db = dbPlataforma();
    const todosNegocios = await db.select().from(negocios).orderBy(desc(negocios.creadoEn));

    const resultado = await Promise.all(
      todosNegocios.map(async (n) => {
        const { rows: rConteo } = await db.execute<{ total: number }>(sql`
          select count(distinct u_id)::int as total from (
            select id as u_id from usuarios where negocio_id = ${n.id}
            union
            select usuario_id as u_id from usuarios_sucursales where negocio_id = ${n.id}
          ) sub
        `);
        const totalUsuarios = rConteo[0]?.total ?? 0;

        const [conteoVentas] = await db
          .select({ total: sql<number>`count(*)::int` })
          .from(ventas)
          .where(eq(ventas.negocioId, n.id));

        let dueno: { id: string; nombre: string; usuario: string; activo: boolean; ultimaActividad: Date | null } | undefined;
        const [duenoDirecto] = await db
          .select({
            id: usuarios.id,
            nombre: usuarios.nombre,
            usuario: usuarios.usuario,
            activo: usuarios.activo,
            ultimaActividad: usuarios.ultimaActividad,
          })
          .from(usuarios)
          .innerJoin(roles, eq(usuarios.rolId, roles.id))
          .where(sql`${usuarios.negocioId} = ${n.id} and ${roles.base} = 'dueno'`);

        if (duenoDirecto) {
          dueno = duenoDirecto;
        } else {
          const [duenoAsig] = await db
            .select({
              id: usuarios.id,
              nombre: usuarios.nombre,
              usuario: usuarios.usuario,
              activo: usuarios.activo,
              ultimaActividad: usuarios.ultimaActividad,
            })
            .from(usuariosSucursales)
            .innerJoin(roles, eq(usuariosSucursales.rolId, roles.id))
            .innerJoin(usuarios, eq(usuariosSucursales.usuarioId, usuarios.id))
            .where(sql`${usuariosSucursales.negocioId} = ${n.id} and ${roles.base} = 'dueno'`);
          dueno = duenoAsig;
        }

        return {
          id: n.id,
          nombre: n.nombre,
          telefono: n.telefono,
          ubicacion: n.ubicacion,
          ventanaOfflineHoras: n.ventanaOfflineHoras,
          plazoCreditoDias: n.plazoCreditoDias,
          creadoEn: n.creadoEn.toISOString(),
          totalUsuarios,
          totalVentas: conteoVentas?.total ?? 0,
          dueno: dueno
            ? {
                id: dueno.id,
                nombre: dueno.nombre,
                usuario: dueno.usuario,
                activo: dueno.activo,
                ultimaActividad: dueno.ultimaActividad ? dueno.ultimaActividad.toISOString() : null,
              }
            : null,
        };
      }),
    );

    return resultado;
  }),
);

/** 3. Detalle completo de un local / negocio */
rutasPlataforma.get(
  '/negocios/:id',
  asincrona(async (req) => {
    exigirTokenPlataforma(req);
    const negocioId = String(req.params.id);
    const db = dbPlataforma();
    const [n] = await db.select().from(negocios).where(eq(negocios.id, negocioId));
    if (!n) throw noEncontrado('Local o negocio no encontrado.');

    const listaUsuarios = await db
      .select({
        id: usuarios.id,
        nombre: usuarios.nombre,
        usuario: usuarios.usuario,
        activo: usuarios.activo,
        rolId: roles.id,
        rolNombre: roles.nombre,
        rolBase: roles.base,
        ultimaActividad: usuarios.ultimaActividad,
        creadoEn: usuarios.creadoEn,
      })
      .from(usuarios)
      .innerJoin(roles, eq(usuarios.rolId, roles.id))
      .where(eq(usuarios.negocioId, negocioId))
      .orderBy(desc(usuarios.creadoEn));

    return {
      id: n.id,
      nombre: n.nombre,
      telefono: n.telefono,
      ubicacion: n.ubicacion,
      ventanaOfflineHoras: n.ventanaOfflineHoras,
      plazoCreditoDias: n.plazoCreditoDias,
      creadoEn: n.creadoEn.toISOString(),
      usuarios: listaUsuarios.map((u) => ({
        ...u,
        negocioId,
        ultimaActividad: u.ultimaActividad ? u.ultimaActividad.toISOString() : null,
        creadoEn: u.creadoEn.toISOString(),
      })),
    };
  }),
);

/** 4. Crear un nuevo local / negocio con su Dueño */
rutasPlataforma.post(
  '/negocios',
  asincrona(async (req) => {
    exigirTokenPlataforma(req);
    const d = z
      .object({
        nombre: z.string().trim().min(1).max(120),
        telefono: z.string().trim().max(30).nullable().default(null),
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

/** 5. Editar datos generales del local / negocio */
rutasPlataforma.patch(
  '/negocios/:id',
  asincrona(async (req) => {
    exigirTokenPlataforma(req);
    const negocioId = String(req.params.id);
    const d = z
      .object({
        nombre: z.string().trim().min(1).max(120).optional(),
        telefono: z.string().trim().max(30).nullable().optional(),
        ubicacion: z.string().trim().max(200).nullable().optional(),
        ventanaOfflineHoras: z.number().int().min(1).max(72).optional(),
        plazoCreditoDias: z.number().int().min(1).max(120).optional(),
      })
      .parse(req.body);

    const db = dbPlataforma();
    const [actualizado] = await db
      .update(negocios)
      .set(d)
      .where(eq(negocios.id, negocioId))
      .returning();
    if (!actualizado) throw noEncontrado('Local o negocio no encontrado.');
    return actualizado;
  }),
);

/** 6. Listar usuarios de un local */
rutasPlataforma.get(
  '/negocios/:id/usuarios',
  asincrona(async (req) => {
    exigirTokenPlataforma(req);
    const negocioId = String(req.params.id);
    const db = dbPlataforma();
    const listaUsuarios = await db
      .select({
        id: usuarios.id,
        nombre: usuarios.nombre,
        usuario: usuarios.usuario,
        activo: usuarios.activo,
        rolId: roles.id,
        rolNombre: roles.nombre,
        rolBase: roles.base,
        ultimaActividad: usuarios.ultimaActividad,
        creadoEn: usuarios.creadoEn,
      })
      .from(usuarios)
      .innerJoin(roles, eq(usuarios.rolId, roles.id))
      .where(eq(usuarios.negocioId, negocioId))
      .orderBy(desc(usuarios.creadoEn));

    return listaUsuarios.map((u) => ({
      ...u,
      negocioId,
      ultimaActividad: u.ultimaActividad ? u.ultimaActividad.toISOString() : null,
      creadoEn: u.creadoEn.toISOString(),
    }));
  }),
);

/** 7. Crear usuario en un local específico */
rutasPlataforma.post(
  '/negocios/:id/usuarios',
  asincrona(async (req) => {
    exigirTokenPlataforma(req);
    const negocioId = String(req.params.id);
    const d = z
      .object({
        nombre: z.string().trim().min(2).max(120),
        usuario: z.string().trim().min(3).max(80),
        contrasena: z.string().min(6).max(200),
        rolBase: z.enum(['administrador', 'trabajador', 'dueno']),
      })
      .parse(req.body);

    const db = dbPlataforma();
    const [rol] = await db
      .select()
      .from(roles)
      .where(sql`${roles.negocioId} = ${negocioId} and ${roles.base} = ${d.rolBase}`);
    if (!rol) throw noEncontrado('El rol especificado no existe para este negocio.');

    const hash = await hashContrasena(d.contrasena);
    try {
      const nuevoId = uuid();
      await db.insert(usuarios).values({
        id: nuevoId,
        negocioId,
        nombre: d.nombre,
        usuario: d.usuario.toLowerCase(),
        contrasenaHash: hash,
        rolId: rol.id,
        activo: true,
      });
      return { id: nuevoId, nombre: d.nombre, usuario: d.usuario.toLowerCase(), rolId: rol.id, rolBase: d.rolBase };
    } catch (e) {
      if (esUnicidad(e)) throw conflicto('El nombre de usuario ya está registrado.');
      throw e;
    }
  }),
);

/** 8. Activar o suspender usuario de cualquier local */
rutasPlataforma.patch(
  '/usuarios/:id/estado',
  asincrona(async (req) => {
    exigirTokenPlataforma(req);
    const usuarioId = String(req.params.id);
    const d = z.object({ activo: z.boolean() }).parse(req.body);

    const db = dbPlataforma();
    const [u] = await db
      .update(usuarios)
      .set({ activo: d.activo })
      .where(eq(usuarios.id, usuarioId))
      .returning({ id: usuarios.id, activo: usuarios.activo });
    if (!u) throw noEncontrado('Usuario no encontrado.');
    return u;
  }),
);

/** 9. Restablecer contraseña de cualquier usuario */
rutasPlataforma.post(
  '/usuarios/:id/resetear-clave',
  asincrona(async (req) => {
    exigirTokenPlataforma(req);
    const usuarioId = String(req.params.id);
    const d = z.object({ contrasena: z.string().min(6).max(200) }).parse(req.body);
    const hash = await hashContrasena(d.contrasena);

    const db = dbPlataforma();
    const [u] = await db
      .update(usuarios)
      .set({ contrasenaHash: hash })
      .where(eq(usuarios.id, usuarioId))
      .returning({ id: usuarios.id });
    if (!u) throw noEncontrado('Usuario no encontrado.');
    return { ok: true, mensaje: 'Contraseña actualizada exitosamente.' };
  }),
);
