/**
 * Alertas de conciliación: clasificaciones cuya existencia no coincide con su historial.
 * El historial de movimientos es la fuente de verdad: "corregir" iguala la existencia a la suma.
 */
import type { AlertaInventario } from '@micentralmx/shared/api';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { alertasInventario, clasificaciones, existencias, productos, unidades } from '../db/esquema';
import { conflicto, noEncontrado } from '../http/errores';
import { rutaNegocio } from '../http/ruta';
import { registrarAuditoria } from '../lib/auditoria';
import { D } from '../lib/dinero';

export const rutasAlertas = Router();

rutasAlertas.get(
  '/inventario/alertas',
  rutaNegocio('inventario.ajustar', async ({ tx }) => {
    const filas = await tx
      .select({ a: alertasInventario, c: clasificaciones.nombre, p: productos.nombre, productoId: productos.id, u: unidades.plural })
      .from(alertasInventario)
      .innerJoin(clasificaciones, eq(clasificaciones.id, alertasInventario.clasificacionId))
      .innerJoin(productos, eq(productos.id, clasificaciones.productoId))
      .innerJoin(unidades, eq(unidades.id, productos.unidadId))
      .where(isNull(alertasInventario.resueltaEn))
      .orderBy(desc(alertasInventario.detectadaEn));
    return filas.map(
      ({ a, c, p, productoId, u }): AlertaInventario => ({
        id: a.id,
        clasificacionId: a.clasificacionId,
        productoId,
        descripcion: `${p} · ${c}`,
        unidadPlural: u,
        existencia: a.existencia,
        sumaMovimientos: a.sumaMovimientos,
        detectadaEn: a.detectadaEn.toISOString(),
      }),
    );
  }),
);

/** Ejecuta la conciliación solo para el negocio de la solicitud (RLS). */
rutasAlertas.post(
  '/inventario/conciliar',
  rutaNegocio('inventario.ajustar', async ({ tx }) => {
    const { rows } = await tx.execute<{ abiertas: number; cerradas: number }>(sql`select * from conciliar_existencias()`);
    return rows[0];
  }),
);

rutasAlertas.post(
  '/inventario/alertas/:id/corregir',
  rutaNegocio('inventario.ajustar', async ({ tx, usuario, req }) => {
    const id = z.uuid().parse(req.params.id);
    const [a] = await tx.select().from(alertasInventario).where(eq(alertasInventario.id, id)).for('update');
    if (!a) throw noEncontrado('La alerta no existe.');
    if (a.resueltaEn) throw conflicto('La alerta ya se resolvió.');
    // Bloquea la existencia y recalcula la suma en ese momento (puede haber cambiado desde la noche).
    await tx.select().from(existencias).where(eq(existencias.clasificacionId, a.clasificacionId)).for('update');
    const { rows } = await tx.execute<{ suma: string }>(
      sql`select coalesce(sum(delta), 0)::text as suma from movimientos_inventario where clasificacion_id = ${a.clasificacionId}`,
    );
    const suma = rows[0].suma;
    const [antes] = await tx.select().from(existencias).where(eq(existencias.clasificacionId, a.clasificacionId));
    await tx
      .insert(existencias)
      .values({ clasificacionId: a.clasificacionId, negocioId: usuario.negocioId, cantidad: suma })
      .onConflictDoUpdate({ target: existencias.clasificacionId, set: { cantidad: suma } });
    await tx
      .update(alertasInventario)
      .set({ resolucion: 'corregida', resueltaPor: usuario.id, resueltaEn: new Date() })
      .where(and(eq(alertasInventario.id, id), isNull(alertasInventario.resueltaEn)));
    const [c] = await tx
      .select({ c: clasificaciones.nombre, p: productos.nombre })
      .from(clasificaciones)
      .innerJoin(productos, eq(productos.id, clasificaciones.productoId))
      .where(eq(clasificaciones.id, a.clasificacionId));
    await registrarAuditoria(tx, usuario, 'inventario', `${usuario.nombre} igualó la existencia de ${c.p} ${c.c} a su historial: ${D(antes?.cantidad ?? 0)} → ${D(suma)}`, {
      tabla: 'existencias',
      registroId: a.clasificacionId,
      antes: { cantidad: antes?.cantidad ?? '0' },
      despues: { cantidad: suma },
    });
    return { existencia: suma };
  }),
);
