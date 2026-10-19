import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { ajustesProductor, cargas, liquidaciones, liquidacionRenglones, ventaRenglones, ventas } from '../db/esquema';
import { conflicto, noEncontrado } from '../http/errores';
import { rutaNegocio } from '../http/ruta';
import { registrarAuditoria } from '../lib/auditoria';
import { aImporte, D, folioVenta } from '../lib/dinero';
import { moverExistencia } from '../lib/inventario';
import * as mapa from '../lib/mapeo';

export const rutasVentas = Router();

rutasVentas.get(
  '/ventas/:id',
  rutaNegocio(null, async ({ tx, req }) => {
    const id = z.uuid().parse(req.params.id);
    const [v] = await tx.select().from(ventas).where(eq(ventas.id, id));
    if (!v) throw noEncontrado('La venta no existe.');
    const renglones = await tx.select().from(ventaRenglones).where(eq(ventaRenglones.ventaId, id)).orderBy(asc(ventaRenglones.linea));
    return mapa.venta(v, renglones.map(mapa.renglonVenta));
  }),
);

/** La venta no se borra: cambia a cancelada y la mercancía regresa con un movimiento inverso (propuesta §6.5). */
rutasVentas.post(
  '/ventas/:id/cancelar',
  rutaNegocio('ventas.cancelar', async ({ tx, usuario, req }) => {
    const id = z.uuid().parse(req.params.id);
    const { motivo } = z.object({ motivo: z.string().trim().min(1, 'Indica el motivo.').max(300) }).parse(req.body);
    const [v] = await tx.select().from(ventas).where(eq(ventas.id, id)).for('update');
    if (!v) throw noEncontrado('La venta no existe en el servidor.');
    if (v.estado === 'cancelada') throw conflicto('La venta ya está cancelada.');
    if (D(v.pagado).gt(0)) throw conflicto('La venta tiene pagos registrados; revisa los pagos antes de cancelar.');
    const ahora = new Date();
    const renglones = await tx.select().from(ventaRenglones).where(eq(ventaRenglones.ventaId, id));
    for (const r of renglones) {
      let cargaIdDevolver: string | undefined = undefined;

      if (r.cargaId) {
        const [c] = await tx.select().from(cargas).where(eq(cargas.id, r.cargaId)).for('update');
        if (c) {
          if (c.estado === 'cerrada') {
            await tx.update(cargas).set({ estado: 'abierta', cerradaEn: null }).where(eq(cargas.id, r.cargaId));
          }
          cargaIdDevolver = r.cargaId;
        }
      }

      await moverExistencia(tx, {
        negocioId: usuario.negocioId,
        clasificacionId: r.clasificacionId,
        productoId: r.productoId,
        delta: r.cantidad,
        tipo: 'cancelacion',
        referencia: `Venta ${folioVenta(v.folio)}`,
        motivo,
        usuarioId: usuario.id,
        usuarioNombre: usuario.nombre,
        creadoEn: ahora,
        cargaId: cargaIdDevolver,
      });
    }

    // Si algún renglón de la venta ya estaba en una liquidación, crear cargo de ajuste al productor
    const renglonesCortados = await tx
      .select({
        linea: liquidacionRenglones.linea,
        importe: liquidacionRenglones.importe,
        liquidacionId: liquidaciones.id,
        folioLiquidacion: liquidaciones.folio,
        proveedorId: liquidaciones.proveedorId,
        totalVendido: liquidaciones.totalVendido,
        comisionFinal: liquidaciones.comisionFinal,
      })
      .from(liquidacionRenglones)
      .innerJoin(liquidaciones, eq(liquidaciones.id, liquidacionRenglones.liquidacionId))
      .where(eq(liquidacionRenglones.ventaId, id));

    const porCorte = new Map<string, { proveedorId: string; folio: number; monto: ReturnType<typeof D> }>();
    for (const rc of renglonesCortados) {
      const totalV = D(rc.totalVendido);
      const comFinal = D(rc.comisionFinal);
      const tasaEfectiva = totalV.gt(0) ? comFinal.div(totalV) : D(0);
      const cargoRenglon = D(rc.importe).mul(D(1).minus(tasaEfectiva));

      const previo = porCorte.get(rc.liquidacionId) ?? { proveedorId: rc.proveedorId, folio: rc.folioLiquidacion, monto: D(0) };
      previo.monto = previo.monto.plus(cargoRenglon);
      porCorte.set(rc.liquidacionId, previo);
    }

    for (const datosCorte of porCorte.values()) {
      const montoCargo = aImporte(datosCorte.monto);
      if (D(montoCargo).gt(0)) {
        await tx.insert(ajustesProductor).values({
          id: crypto.randomUUID(),
          negocioId: usuario.negocioId,
          proveedorId: datosCorte.proveedorId,
          tipo: 'cargo',
          categoria: 'cancelacion',
          concepto: `Cancelación Venta ${folioVenta(v.folio)} · Corte #${datosCorte.folio}`,
          monto: montoCargo,
          ventaId: id,
          usuarioId: usuario.id,
          usuarioNombre: usuario.nombre,
          creadoEn: ahora,
        });
      }
    }

    await tx.update(ventas).set({ estado: 'cancelada', canceladaEn: ahora }).where(eq(ventas.id, id));
    await registrarAuditoria(tx, usuario, 'ventas', `${usuario.nombre} canceló la venta ${folioVenta(v.folio)}: ${motivo}`, {
      tabla: 'ventas',
      registroId: id,
      antes: { estado: v.estado },
      despues: { estado: 'cancelada', motivo },
    });
    return null;
  }),
);

rutasVentas.post(
  '/ventas/:id/confirmar-transferencia',
  rutaNegocio('ventas.confirmar_transferencia', async ({ tx, usuario, req }) => {
    const id = z.uuid().parse(req.params.id);
    const [v] = await tx.select().from(ventas).where(eq(ventas.id, id)).for('update');
    if (!v || v.estado !== 'por_confirmar') throw conflicto('La venta no tiene una transferencia por confirmar.');
    await tx.update(ventas).set({ estado: 'completada' }).where(eq(ventas.id, id));
    await registrarAuditoria(tx, usuario, 'ventas', `${usuario.nombre} confirmó la transferencia de la venta ${folioVenta(v.folio)}`, { tabla: 'ventas', registroId: id });
    return null;
  }),
);
