import { sql } from 'drizzle-orm';
import { v7 as uuid } from 'uuid';
import type { Tx } from '../db/pool';
import { movimientosInventario } from '../db/esquema';
import { D } from './dinero';

/**
 * Registra un movimiento inmutable y actualiza la existencia EN LA MISMA transacción
 * con una suma atómica (decisiones técnicas §4.4). Devuelve la existencia resultante.
 */
export async function moverExistencia(
  tx: Tx,
  m: {
    negocioId: string;
    clasificacionId: string;
    productoId: string;
    delta: string;
    tipo: 'inicial' | 'compra' | 'venta' | 'merma' | 'ajuste' | 'cancelacion' | 'carga' | 'devolucion';
    referencia?: string | null;
    motivo?: string | null;
    cargaId?: string | null;
    usuarioId: string | null;
    usuarioNombre: string;
    creadoEn: Date;
    id?: string;
  },
) {
  await tx.insert(movimientosInventario).values({
    id: m.id ?? uuid(),
    negocioId: m.negocioId,
    clasificacionId: m.clasificacionId,
    productoId: m.productoId,
    delta: m.delta,
    tipo: m.tipo,
    referencia: m.referencia ?? null,
    motivo: m.motivo ?? null,
    cargaId: m.cargaId ?? null,
    usuarioId: m.usuarioId,
    usuarioNombre: m.usuarioNombre,
    creadoEn: m.creadoEn,
  });
  let quedaCarga: ReturnType<typeof D> | null = null;
  if (m.cargaId) {
    const { rows: rowsCarga } = await tx.execute<{ cantidad: string }>(sql`
      insert into existencias_carga (carga_id, clasificacion_id, negocio_id, cantidad)
      values (${m.cargaId}, ${m.clasificacionId}, ${m.negocioId}, ${m.delta})
      on conflict (carga_id, clasificacion_id) do update set cantidad = existencias_carga.cantidad + excluded.cantidad
      returning cantidad
    `);
    quedaCarga = D(rowsCarga[0].cantidad);
  }
  const { rows } = await tx.execute<{ cantidad: string }>(sql`
    insert into existencias (clasificacion_id, negocio_id, cantidad)
    values (${m.clasificacionId}, ${m.negocioId}, ${m.delta})
    on conflict (clasificacion_id) do update set cantidad = existencias.cantidad + excluded.cantidad
    returning cantidad`);
  const quedaTotal = D(rows[0].cantidad);
  if (quedaCarga && quedaCarga.lt(0) && quedaCarga.lt(quedaTotal)) {
    return quedaCarga;
  }
  return quedaTotal;
}
