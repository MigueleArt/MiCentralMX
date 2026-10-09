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
    tipo: 'inicial' | 'compra' | 'venta' | 'merma' | 'ajuste' | 'cancelacion';
    referencia?: string | null;
    motivo?: string | null;
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
    usuarioId: m.usuarioId,
    usuarioNombre: m.usuarioNombre,
    creadoEn: m.creadoEn,
  });
  const { rows } = await tx.execute<{ cantidad: string }>(sql`
    insert into existencias (clasificacion_id, negocio_id, cantidad)
    values (${m.clasificacionId}, ${m.negocioId}, ${m.delta})
    on conflict (clasificacion_id) do update set cantidad = existencias.cantidad + excluded.cantidad
    returning cantidad`);
  return D(rows[0].cantidad);
}
