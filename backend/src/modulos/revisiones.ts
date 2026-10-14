/**
 * Revisiones: operaciones que llegaron del dispositivo y quedaron "en revisión" o "rechazadas"
 * (propuesta §7.1 paso 5). Un usuario con permiso las aprueba, las reaplica o las descarta.
 */
import type { AccionRevision, OperacionEnRevision, TipoOperacion } from '@micentralmx/shared/api';
import { and, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Router } from 'express';
import { z } from 'zod';
import type { Tx } from '../db/pool';
import { clientes, dispositivos, operacionesSync, pagos, usuarios, ventas } from '../db/esquema';
import { conflicto, noEncontrado } from '../http/errores';
import { cargarUsuario, rutaNegocio } from '../http/ruta';
import { registrarAuditoria } from '../lib/auditoria';
import { aplicarOperacion } from './sync/aplicar';

export const rutasRevisiones = Router();

const resolutor = alias(usuarios, 'resolutor');

async function listar(tx: Tx, resueltas: boolean, operacionId?: string): Promise<OperacionEnRevision[]> {
  const filas = await tx
    .select({ o: operacionesSync, autor: usuarios.nombre, codigo: dispositivos.codigo, resolutor: resolutor.nombre })
    .from(operacionesSync)
    .leftJoin(usuarios, eq(usuarios.id, operacionesSync.usuarioId))
    .leftJoin(dispositivos, eq(dispositivos.id, operacionesSync.dispositivoId))
    .leftJoin(resolutor, eq(resolutor.id, operacionesSync.resueltaPor))
    .where(
      operacionId
        ? eq(operacionesSync.operacionId, operacionId)
        : and(ne(operacionesSync.estado, 'aplicada'), resueltas ? isNotNull(operacionesSync.resueltaEn) : isNull(operacionesSync.resueltaEn)),
    )
    .orderBy(desc(operacionesSync.recibidoEn))
    .limit(200);
  return filas.map(({ o, autor, codigo, resolutor: quien }) => {
    const d = (o.datos ?? {}) as { id?: string; clienteId?: string };
    return {
      operacionId: o.operacionId,
      tipo: o.tipo as TipoOperacion,
      resumen: o.resumen,
      estado: o.estado as 'en_revision' | 'rechazada',
      aplicada: o.aplicada,
      motivo: o.motivo,
      usuarioNombre: autor,
      dispositivoCodigo: codigo,
      creadoEnDispositivo: o.creadoEnDispositivo.toISOString(),
      recibidoEn: o.recibidoEn.toISOString(),
      entidadId: d.id ?? null,
      clienteId: d.clienteId ?? (o.tipo === 'cliente.crear' ? (d.id ?? null) : null),
      resolucion: o.resolucion,
      notaResolucion: o.notaResolucion,
      resueltaPorNombre: quien,
      resueltaEn: o.resueltaEn?.toISOString() ?? null,
    };
  });
}

rutasRevisiones.get(
  '/revisiones',
  rutaNegocio('revisiones.resolver', async ({ tx, req }) => listar(tx, req.query.estado === 'resueltas')),
);

rutasRevisiones.get(
  '/revisiones/conteo',
  rutaNegocio('revisiones.resolver', async ({ tx }) => {
    const { rows } = await tx.execute<{ n: string }>(
      sql`select count(*)::text as n from operaciones_sync where estado <> 'aplicada' and resuelta_en is null`,
    );
    return { pendientes: Number(rows[0].n) };
  }),
);

/** Quita la marca de revisión del registro afectado al aprobar. */
async function limpiarMarca(tx: Tx, tipo: string, entidadId: string | undefined) {
  if (!entidadId) return;
  if (tipo === 'venta.crear') await tx.update(ventas).set({ requiereRevision: false }).where(eq(ventas.id, entidadId));
  if (tipo === 'pago.crear') await tx.update(pagos).set({ requiereRevision: false }).where(eq(pagos.id, entidadId));
  if (tipo === 'cliente.crear') await tx.update(clientes).set({ requiereRevision: false }).where(eq(clientes.id, entidadId));
}

rutasRevisiones.post(
  '/revisiones/:id/resolver',
  rutaNegocio('revisiones.resolver', async ({ tx, usuario, req }) => {
    const operacionId = z.uuid().parse(req.params.id);
    const { accion, nota } = z.object({ accion: z.enum(['aprobar', 'reaplicar', 'descartar']), nota: z.string().trim().max(500).optional() }).parse(req.body) as {
      accion: AccionRevision;
      nota?: string;
    };
    const [o] = await tx.select().from(operacionesSync).where(eq(operacionesSync.operacionId, operacionId)).for('update');
    if (!o || o.estado === 'aplicada') throw noEncontrado('La operación no está en revisión.');
    if (o.resueltaEn) throw conflicto('La operación ya se resolvió.');
    const entidadId = (o.datos as { id?: string }).id;
    const resolver = (resolucion: 'aprobada' | 'reaplicada' | 'descartada', extra: Partial<typeof operacionesSync.$inferInsert> = {}) =>
      tx
        .update(operacionesSync)
        .set({ resolucion, notaResolucion: nota || null, resueltaPor: usuario.id, resueltaEn: new Date(), ...extra })
        .where(eq(operacionesSync.operacionId, operacionId));

    if (accion === 'aprobar') {
      if (!o.aplicada) throw conflicto('Esta operación no se aplicó; reaplícala o descártala.');
      await limpiarMarca(tx, o.tipo, entidadId);
      await resolver('aprobada');
    } else if (accion === 'descartar') {
      if (o.aplicada) throw conflicto('La operación ya está registrada; para revertirla usa la cancelación o un ajuste.');
      await resolver('descartada');
    } else {
      if (o.aplicada || o.estado === 'rechazada') throw conflicto('Solo se reaplican operaciones que esperaban un registro faltante.');
      const autor = o.usuarioId ? await cargarUsuario(tx, o.usuarioId) : null;
      if (!autor) throw conflicto('El usuario que registró la operación ya no existe.');
      const r = await aplicarOperacion(tx, o.tipo, o.datos, {
        autor,
        dispositivoId: o.dispositivoId,
        creadoEnDispositivo: o.creadoEnDispositivo,
        revisionGeneral: [],
      });
      if (!r.aplicada) throw conflicto(r.motivo ?? 'No se pudo aplicar.');
      const cambios = { estado: r.estado, aplicada: true, motivo: r.motivo, resultado: r.resultado, resumen: r.resumen };
      // Si al reaplicarse quedó con otra observación (p. ej. existencia negativa), sigue pendiente de aprobar.
      if (r.estado === 'en_revision') await tx.update(operacionesSync).set(cambios).where(eq(operacionesSync.operacionId, operacionId));
      else await resolver('reaplicada', cambios);
    }
    await registrarAuditoria(tx, usuario, 'revisiones', `${usuario.nombre} ${{ aprobar: 'aprobó', reaplicar: 'reaplicó', descartar: 'descartó' }[accion]} ${o.resumen}${nota ? `: ${nota}` : ''}`, {
      tabla: 'operaciones_sync',
      registroId: operacionId,
    });
    return (await listar(tx, false, operacionId))[0];
  }),
);
