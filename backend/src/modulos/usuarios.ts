import type { RolNegocio, UsuarioNegocio } from '@micentralmx/shared/api';
import { TODOS_LOS_PERMISOS } from '@micentralmx/shared/permisos';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { v7 as uuid } from 'uuid';
import { z } from 'zod';
import { hashContrasena } from '../auth/tokens';
import { roles, sesionesRefresh, usuarios } from '../db/esquema';
import { conflicto, esUnicidad, noEncontrado } from '../http/errores';
import { rutaNegocio } from '../http/ruta';
import { registrarAuditoria } from '../lib/auditoria';

export const rutasUsuarios = Router();

const aRol = (r: typeof roles.$inferSelect): RolNegocio => ({ id: r.id, nombre: r.nombre, base: r.base, permisos: r.permisos, editable: r.editable });

rutasUsuarios.get(
  '/usuarios',
  rutaNegocio('usuarios.gestionar', async ({ tx }) => {
    const filas = await tx.select({ u: usuarios, r: roles }).from(usuarios).innerJoin(roles, eq(roles.id, usuarios.rolId)).orderBy(asc(usuarios.nombre));
    return filas.map(
      ({ u, r }): UsuarioNegocio => ({
        id: u.id,
        nombre: u.nombre,
        usuario: u.usuario,
        rolId: u.rolId,
        rolNombre: r.nombre,
        activo: u.activo,
        ultimaActividad: u.ultimaActividad?.toISOString() ?? null,
      }),
    );
  }),
);

rutasUsuarios.get('/roles', rutaNegocio(null, async ({ tx }) => (await tx.select().from(roles).orderBy(asc(roles.nombre))).map(aRol)));

rutasUsuarios.put(
  '/roles/:id',
  rutaNegocio('usuarios.gestionar', async ({ tx, usuario, req }) => {
    const { permisos } = z.object({ permisos: z.array(z.enum(TODOS_LOS_PERMISOS as [string, ...string[]])).max(TODOS_LOS_PERMISOS.length) }).parse(req.body);
    const [r] = await tx.select().from(roles).where(eq(roles.id, String(req.params.id)));
    if (!r) throw noEncontrado('El rol no existe.');
    if (!r.editable) throw conflicto('El rol Dueño no se puede editar.');
    const unicos = [...new Set(permisos)];
    await tx.update(roles).set({ permisos: unicos }).where(eq(roles.id, r.id));
    await registrarAuditoria(tx, usuario, 'usuarios', `${usuario.nombre} cambió los permisos del rol ${r.nombre}`, {
      tabla: 'roles',
      registroId: r.id,
      antes: { permisos: r.permisos },
      despues: { permisos: unicos },
    });
    return aRol({ ...r, permisos: unicos });
  }),
);

const esquemaNuevo = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre.').max(120),
  usuario: z.string().trim().min(3, 'El usuario debe tener al menos 3 caracteres.').max(80),
  rolId: z.uuid(),
  contrasena: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(200),
});

rutasUsuarios.post(
  '/usuarios',
  rutaNegocio('usuarios.gestionar', async ({ tx, usuario, req }) => {
    const d = esquemaNuevo.parse(req.body);
    const [rol] = await tx.select().from(roles).where(eq(roles.id, d.rolId));
    if (!rol) throw noEncontrado('El rol no existe.');
    if (rol.base === 'dueno') throw conflicto('Solo puede haber un Dueño.');
    const id = uuid();
    try {
      // Savepoint: si el login ya existe, la transacción de la solicitud sigue usable para responder.
      await tx.transaction((sp) =>
        sp.insert(usuarios).values({ id, negocioId: usuario.negocioId, nombre: d.nombre, usuario: d.usuario.toLowerCase(), contrasenaHash: '', rolId: rol.id, activo: true }),
      );
    } catch (e) {
      if (esUnicidad(e)) throw conflicto('Ese usuario ya existe.');
      throw e;
    }
    await tx.update(usuarios).set({ contrasenaHash: await hashContrasena(d.contrasena) }).where(eq(usuarios.id, id));
    await registrarAuditoria(tx, usuario, 'usuarios', `${usuario.nombre} agregó al usuario ${d.nombre} (${rol.nombre})`, { tabla: 'usuarios', registroId: id });
    return { id, nombre: d.nombre, usuario: d.usuario.toLowerCase(), rolId: rol.id, rolNombre: rol.nombre, activo: true, ultimaActividad: null } satisfies UsuarioNegocio;
  }),
);

rutasUsuarios.patch(
  '/usuarios/:id',
  rutaNegocio('usuarios.gestionar', async ({ tx, usuario, req }) => {
    const d = z
      .object({
        nombre: z.string().trim().min(2).max(120).optional(),
        rolId: z.uuid().optional(),
        contrasena: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(200).optional(),
        activo: z.boolean().optional(),
      })
      .parse(req.body);
    const [u] = await tx.select({ u: usuarios, r: roles }).from(usuarios).innerJoin(roles, eq(roles.id, usuarios.rolId)).where(eq(usuarios.id, String(req.params.id)));
    if (!u) throw noEncontrado('El usuario no existe.');
    const esDueno = u.r.base === 'dueno';
    if (esDueno && (d.activo === false || (d.rolId && d.rolId !== u.r.id))) throw conflicto('El Dueño no se puede suspender ni cambiar de rol.');
    if (d.activo === false && u.u.id === usuario.id) throw conflicto('No puedes suspenderte a ti mismo.');
    let rolNombre = u.r.nombre;
    if (d.rolId && d.rolId !== u.r.id) {
      const [rol] = await tx.select().from(roles).where(eq(roles.id, d.rolId));
      if (!rol) throw noEncontrado('El rol no existe.');
      if (rol.base === 'dueno') throw conflicto('Solo puede haber un Dueño.');
      rolNombre = rol.nombre;
    }
    await tx
      .update(usuarios)
      .set({
        ...(d.nombre ? { nombre: d.nombre } : {}),
        ...(d.rolId ? { rolId: d.rolId } : {}),
        ...(d.activo !== undefined ? { activo: d.activo } : {}),
        ...(d.contrasena ? { contrasenaHash: await hashContrasena(d.contrasena) } : {}),
      })
      .where(eq(usuarios.id, u.u.id));
    // Al suspender o restablecer la contraseña se cierran sus sesiones en línea.
    if (d.activo === false || d.contrasena) {
      await tx.update(sesionesRefresh).set({ revocadoEn: new Date() }).where(and(eq(sesionesRefresh.usuarioId, u.u.id), isNull(sesionesRefresh.revocadoEn)));
    }
    const accion = d.activo === false ? 'suspendió' : d.activo === true && !u.u.activo ? 'reactivó' : d.contrasena ? 'restableció la contraseña de' : 'editó';
    await registrarAuditoria(tx, usuario, 'usuarios', `${usuario.nombre} ${accion} al usuario ${u.u.nombre}`, {
      tabla: 'usuarios',
      registroId: u.u.id,
      antes: { nombre: u.u.nombre, rolId: u.u.rolId, activo: u.u.activo },
      despues: { nombre: d.nombre, rolId: d.rolId, activo: d.activo },
    });
    const activo = d.activo ?? u.u.activo;
    return {
      id: u.u.id,
      nombre: d.nombre ?? u.u.nombre,
      usuario: u.u.usuario,
      rolId: d.rolId ?? u.u.rolId,
      rolNombre,
      activo,
      ultimaActividad: u.u.ultimaActividad?.toISOString() ?? null,
    } satisfies UsuarioNegocio;
  }),
);
