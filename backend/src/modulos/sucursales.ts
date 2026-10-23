import type { RespuestaLogin, SucursalResumen } from '@micentralmx/shared/api';
import { ROLES_BASE, type RolBase } from '@micentralmx/shared/permisos';
import { and, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { v7 as uuid } from 'uuid';
import { z } from 'zod';
import { aUsuarioSesion, emitirRefresh, negocioYConfiguracion } from '../auth/rutas';
import { COOKIE_REFRESH, firmarAcceso, opcionesCookie } from '../auth/tokens';
import { conNegocio } from '../db/pool';
import { negocios, roles, unidades, usuariosSucursales } from '../db/esquema';
import { ErrorHttp, conflicto, noEncontrado, prohibido } from '../http/errores';
import { cargarUsuario, rutaNegocio } from '../http/ruta';
import { registrarAuditoria } from '../lib/auditoria';
import { UNIDADES_INICIALES } from './plataforma';

export const rutasSucursales = Router();

const esquemaNuevaSucursal = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre de la sucursal o bodega.').max(120),
  ubicacion: z.string().trim().max(160).optional().nullable(),
  telefono: z.string().trim().max(40).optional().nullable(),
});

/** 1. Listar todas las sucursales del negocio / empresa */
rutasSucursales.get(
  '/sucursales',
  rutaNegocio(null, async ({ tx, usuario }) => {
    const { rows } = await tx.execute<{
      id: string;
      nombre: string;
      ubicacion: string | null;
      telefono: string | null;
      matriz_id: string | null;
      creado_en: Date;
    }>(sql`select * from plataforma.buscar_sucursales_negocio(${usuario.negocioId})`);

    // Contar usuarios en cada sucursal
    const res: SucursalResumen[] = [];
    const esDueno = usuario.rolBase === 'dueno';

    for (const fila of rows) {
      // Verificar si el usuario tiene acceso a esta sucursal
      let tieneAcceso = esDueno || fila.id === usuario.negocioId;
      if (!tieneAcceso) {
        const { rows: rAsig } = await tx.execute<{ existe: boolean }>(
          sql`select exists(select 1 from usuarios_sucursales where usuario_id = ${usuario.id} and negocio_id = ${fila.id}) as existe`,
        );
        tieneAcceso = !!rAsig[0]?.existe;
      }

      if (!tieneAcceso) continue;

      res.push({
        id: fila.id,
        nombre: fila.nombre,
        ubicacion: fila.ubicacion,
        telefono: fila.telefono,
        matrizId: fila.matriz_id,
        esMatriz: !fila.matriz_id,
        esActual: fila.id === usuario.negocioId,
        creadoEn: new Date(fila.creado_en).toISOString(),
      });
    }

    return res;
  }),
);

/** 2. Crear una nueva sucursal o bodega vinculada a la empresa del Dueño */
rutasSucursales.post(
  '/sucursales',
  rutaNegocio(null, async ({ tx, usuario, req }) => {
    // Solo el Dueño puede crear sucursales
    if (usuario.rolBase !== 'dueno') {
      throw prohibido('Solo el Dueño de la empresa puede crear nuevas sucursales o bodegas.');
    }

    const d = esquemaNuevaSucursal.parse(req.body);

    // Obtener la raíz de la empresa (si ya es matriz, su propio ID)
    const { rows: rRaiz } = await tx.execute<{ r_id: string }>(
      sql`select plataforma.empresa_raiz(${usuario.negocioId}) as r_id`,
    );
    const matrizId = rRaiz[0]?.r_id ?? usuario.negocioId;

    const nuevaId = uuid();

    // Crear la sucursal vinculada a la matriz
    await tx.insert(negocios).values({
      id: nuevaId,
      matrizId,
      nombre: d.nombre,
      ubicacion: d.ubicacion ?? null,
      telefono: d.telefono ?? null,
      ventanaOfflineHoras: 24,
      plazoCreditoDias: 7,
    });

    // Configurar roles, asignación y unidades dentro de la misma transacción
    await tx.execute(sql`select set_config('app.negocio_id', ${nuevaId}, true)`);

    const idsRoles = {} as Record<RolBase, string>;
    for (const base of Object.keys(ROLES_BASE) as RolBase[]) {
      idsRoles[base] = uuid();
      await tx.insert(roles).values({
        id: idsRoles[base],
        negocioId: nuevaId,
        nombre: ROLES_BASE[base].nombre,
        base,
        permisos: [...ROLES_BASE[base].permisos],
        editable: base !== 'dueno',
      });
    }

    // Asignar al creador como Dueño en esta sucursal
    await tx.insert(usuariosSucursales).values({
      usuarioId: usuario.id,
      negocioId: nuevaId,
      rolId: idsRoles.dueno,
    });

    // Crear unidades iniciales en la nueva sucursal
    await tx.insert(unidades).values(
      UNIDADES_INICIALES.map(([nom, plural, permiteDecimales]) => ({
        id: uuid(),
        negocioId: nuevaId,
        nombre: nom,
        plural,
        permiteDecimales,
      })),
    );

    // Restaurar app.negocio_id
    await tx.execute(sql`select set_config('app.negocio_id', ${usuario.negocioId}, true)`);

    await registrarAuditoria(tx, usuario, 'negocios', `${usuario.nombre} creó la sucursal ${d.nombre}`, {
      tabla: 'negocios',
      registroId: nuevaId,
    });

    return {
      id: nuevaId,
      nombre: d.nombre,
      ubicacion: d.ubicacion ?? null,
      telefono: d.telefono ?? null,
      matrizId,
      esMatriz: false,
      esActual: false,
      creadoEn: new Date().toISOString(),
    } satisfies SucursalResumen;
  }),
);

/** 3. Cambiar de sucursal activa */
rutasSucursales.post(
  '/sucursales/cambiar',
  rutaNegocio(null, async ({ tx, usuario, req, res }) => {
    const { sucursalId } = z.object({ sucursalId: z.string().uuid() }).parse(req.body);

    if (sucursalId === usuario.negocioId) {
      // Ya está en esta sucursal
      const info = await negocioYConfiguracion(tx, usuario.negocioId);
      return {
        access_token: firmarAcceso(usuario.id, usuario.negocioId),
        usuario: aUsuarioSesion(usuario),
        negocio: info.negocio,
        configuracion: info.configuracion,
      } satisfies RespuestaLogin;
    }

    // Verificar que la sucursal pertenece a la misma empresa
    const { rows: rMisma } = await tx.execute<{ es_misma: boolean }>(
      sql`select (plataforma.empresa_raiz(${usuario.negocioId}) = plataforma.empresa_raiz(${sucursalId})) as es_misma`,
    );

    if (!rMisma[0]?.es_misma) {
      throw new ErrorHttp(403, 'No tienes acceso a esta sucursal.', 'sin_permiso');
    }

    const esDueno = usuario.rolBase === 'dueno';

    // Abrir contexto en la sucursal destino
    const resultado = await conNegocio(sucursalId, async (txDestino) => {
      // Si es Dueño, asegurar que tiene rol asignado en la sucursal destino
      if (esDueno) {
        const [asigExistente] = await txDestino
          .select()
          .from(usuariosSucursales)
          .where(and(eq(usuariosSucursales.usuarioId, usuario.id), eq(usuariosSucursales.negocioId, sucursalId)));

        if (!asigExistente) {
          const [rolDueno] = await txDestino.select().from(roles).where(eq(roles.base, 'dueno'));
          if (rolDueno) {
            await txDestino.insert(usuariosSucursales).values({
              usuarioId: usuario.id,
              negocioId: sucursalId,
              rolId: rolDueno.id,
            });
          }
        }
      }

      const uDestino = await cargarUsuario(txDestino, usuario.id);
      if (!uDestino || !uDestino.activo) {
        throw new ErrorHttp(403, 'No tienes un rol activo en esta sucursal.', 'sin_permiso');
      }

      const refresh = await emitirRefresh(txDestino, uDestino.id, sucursalId);
      const { negocio, configuracion } = await negocioYConfiguracion(txDestino, sucursalId);

      return {
        uDestino,
        refresh,
        negocio,
        configuracion,
      };
    });

    res.cookie(COOKIE_REFRESH, resultado.refresh, opcionesCookie());

    return {
      access_token: firmarAcceso(resultado.uDestino.id, sucursalId),
      usuario: aUsuarioSesion(resultado.uDestino),
      negocio: resultado.negocio,
      configuracion: resultado.configuracion,
    } satisfies RespuestaLogin;
  }),
);

/** 4. Asignar un usuario existente a una sucursal adicional */
rutasSucursales.post(
  '/sucursales/:id/usuarios',
  rutaNegocio('usuarios.gestionar', async ({ tx, usuario, req }) => {
    const sucursalId = String(req.params.id);
    const { usuarioId, rolId } = z.object({ usuarioId: z.string().uuid(), rolId: z.string().uuid() }).parse(req.body);

    // Verificar que la sucursal pertenece a la misma empresa
    const { rows: rMisma } = await tx.execute<{ es_misma: boolean }>(
      sql`select (plataforma.empresa_raiz(${usuario.negocioId}) = plataforma.empresa_raiz(${sucursalId})) as es_misma`,
    );
    if (!rMisma[0]?.es_misma) throw noEncontrado('Sucursal no encontrada.');

    await conNegocio(sucursalId, async (txSub) => {
      const [rol] = await txSub.select().from(roles).where(eq(roles.id, rolId));
      if (!rol) throw noEncontrado('El rol especificado no existe en esta sucursal.');

      await txSub
        .insert(usuariosSucursales)
        .values({ usuarioId, negocioId: sucursalId, rolId })
        .onConflictDoUpdate({
          target: [usuariosSucursales.usuarioId, usuariosSucursales.negocioId],
          set: { rolId },
        });
    });

    return { ok: true, mensaje: 'Usuario asignado a la sucursal exitosamente' };
  }),
);

/** 5. Quitar asignación de un usuario a una sucursal */
rutasSucursales.delete(
  '/sucursales/:id/usuarios/:usuarioId',
  rutaNegocio('usuarios.gestionar', async ({ usuario, req }) => {
    const sucursalId = String(req.params.id);
    const usuarioId = String(req.params.usuarioId);

    if (usuarioId === usuario.id) {
      throw conflicto('No puedes remover tu propio acceso a la sucursal.');
    }

    await conNegocio(sucursalId, async (txSub) => {
      await txSub
        .delete(usuariosSucursales)
        .where(and(eq(usuariosSucursales.usuarioId, usuarioId), eq(usuariosSucursales.negocioId, sucursalId)));
    });

    return { ok: true };
  }),
);
