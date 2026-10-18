/** Rutas solo en línea para cargas (cierre y resolución de sobrantes). */
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { cargas, clasificaciones, existenciasCarga } from '../db/esquema';
import { invalido, noEncontrado } from '../http/errores';
import { rutaNegocio } from '../http/ruta';
import { registrarAuditoria } from '../lib/auditoria';
import { D } from '../lib/dinero';
import { moverExistencia } from '../lib/inventario';

const esquemaCierre = z.object({
  resoluciones: z
    .array(
      z.object({
        clasificacionId: z.uuid(),
        accion: z.enum(['merma', 'devolucion']),
        motivo: z.string().trim().max(200).optional(),
      }),
    )
    .default([]),
});

export const rutasCargas = Router();

rutasCargas.post(
  '/cargas/:id/cerrar',
  rutaNegocio('cargas.cerrar', async ({ tx, usuario, req }) => {
    const id = String(req.params.id);
    const d = esquemaCierre.parse(req.body);
    const [carga] = await tx.select().from(cargas).where(eq(cargas.id, id));
    if (!carga) throw noEncontrado('La carga no existe.');
    if (carga.estado === 'cerrada') throw invalido('La carga ya está cerrada.');

    const existencias = await tx.select().from(existenciasCarga).where(eq(existenciasCarga.cargaId, id));
    const sobrantes = existencias.filter((e) => D(e.cantidad).gt(0));

    // Exige que cada sobrante se resuelva como merma o devolución
    for (const sob of sobrantes) {
      const res = d.resoluciones.find((r) => r.clasificacionId === sob.clasificacionId);
      if (!res) {
        throw invalido('Cada sobrante debe resolverse como merma o devolución para poder cerrar la carga.');
      }
    }

    for (const res of d.resoluciones) {
      const sob = existencias.find((e) => e.clasificacionId === res.clasificacionId);
      if (sob && D(sob.cantidad).gt(0)) {
        const [clas] = await tx.select().from(clasificaciones).where(eq(clasificaciones.id, sob.clasificacionId));
        if (clas) {
          await moverExistencia(tx, {
            negocioId: usuario.negocioId,
            clasificacionId: sob.clasificacionId,
            productoId: clas.productoId,
            delta: D(sob.cantidad).neg().toString(),
            tipo: res.accion,
            motivo: res.motivo || (res.accion === 'merma' ? 'Merma al cierre de carga' : 'Devolución al productor al cierre de carga'),
            referencia: `Cierre de carga ${carga.fecha}`,
            cargaId: carga.id,
            usuarioId: usuario.id,
            usuarioNombre: usuario.nombre,
            creadoEn: new Date(),
          });
        }
      }
    }

    const ahora = new Date();
    await tx.update(cargas).set({ estado: 'cerrada', cerradaEn: ahora }).where(eq(cargas.id, id));
    await registrarAuditoria(tx, usuario, 'inventario', `${usuario.nombre} cerró la carga del ${carga.fecha}`, {
      tabla: 'cargas',
      registroId: id,
    });

    return { ok: true, cerradaEn: ahora.toISOString() };
  }),
);
