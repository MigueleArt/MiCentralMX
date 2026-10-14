import type { BloqueFolio, RespuestaRegistroDispositivo, TipoFolio } from '@micentralmx/shared/api';
import { and, eq, gte, lte } from 'drizzle-orm';
import { Router } from 'express';
import { v7 as uuid } from 'uuid';
import { z } from 'zod';
import { config } from '../config';
import type { Tx } from '../db/pool';
import { bloquesFolio, dispositivos } from '../db/esquema';
import { sql } from 'drizzle-orm';
import { noEncontrado } from '../http/errores';
import { rutaNegocio } from '../http/ruta';

/** Incrementa un contador del negocio de forma atómica y devuelve el nuevo valor. */
export async function incrementar(tx: Tx, negocioId: string, clave: string, cantidad: number): Promise<number> {
  const { rows } = await tx.execute<{ valor: string }>(sql`
    insert into contadores (negocio_id, clave, valor) values (${negocioId}, ${clave}, ${cantidad})
    on conflict (negocio_id, clave) do update set valor = contadores.valor + excluded.valor
    returning valor`);
  return Number(rows[0].valor);
}

/** Reserva un bloque de folios definitivos para un dispositivo (decisiones técnicas §4.4). */
export async function reservarBloque(tx: Tx, negocioId: string, dispositivoId: string, tipo: TipoFolio): Promise<BloqueFolio> {
  const hasta = await incrementar(tx, negocioId, `folio_${tipo}`, config.tamanoBloqueFolios);
  const bloque = { id: uuid(), tipo, desde: hasta - config.tamanoBloqueFolios + 1, hasta };
  await tx.insert(bloquesFolio).values({ ...bloque, negocioId, dispositivoId });
  return bloque;
}

/** Folio definitivo para una operación que llegó con folio provisional. */
export const folioSuelto = (tx: Tx, negocioId: string, tipo: TipoFolio) => incrementar(tx, negocioId, `folio_${tipo}`, 1);

/** ¿El folio pertenece a un bloque reservado por ese dispositivo? */
export async function folioDelDispositivo(tx: Tx, dispositivoId: string, tipo: TipoFolio, folio: number) {
  const [b] = await tx
    .select({ id: bloquesFolio.id })
    .from(bloquesFolio)
    .where(and(eq(bloquesFolio.dispositivoId, dispositivoId), eq(bloquesFolio.tipo, tipo), lte(bloquesFolio.desde, folio), gte(bloquesFolio.hasta, folio)))
    .limit(1);
  return !!b;
}

export const rutasDispositivos = Router();

rutasDispositivos.post(
  '/dispositivos',
  rutaNegocio(null, async ({ tx, usuario, req }) => {
    const { nombre } = z.object({ nombre: z.string().max(200).optional() }).parse(req.body ?? {});
    const n = await incrementar(tx, usuario.negocioId, 'dispositivo', 1);
    const id = uuid();
    await tx.insert(dispositivos).values({ id, negocioId: usuario.negocioId, usuarioId: usuario.id, codigo: `D${n}`, nombre: nombre ?? null });
    return {
      dispositivo_id: id,
      codigo: `D${n}`,
      bloques: [await reservarBloque(tx, usuario.negocioId, id, 'venta'), await reservarBloque(tx, usuario.negocioId, id, 'compra')],
    } satisfies RespuestaRegistroDispositivo;
  }),
);

rutasDispositivos.post(
  '/folios/bloques',
  rutaNegocio(null, async ({ tx, usuario, req }) => {
    const b = z.object({ dispositivo_id: z.uuid(), tipo: z.enum(['venta', 'compra']) }).parse(req.body);
    const [d] = await tx.select({ id: dispositivos.id }).from(dispositivos).where(eq(dispositivos.id, b.dispositivo_id));
    if (!d) throw noEncontrado('El dispositivo no está registrado en este negocio.');
    return reservarBloque(tx, usuario.negocioId, d.id, b.tipo);
  }),
);
