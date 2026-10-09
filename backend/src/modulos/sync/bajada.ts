/**
 * Bajada paginada (decisiones técnicas §4.2).
 *
 * Cursor completo: un xid8 ("993"). Trae los cambios de transacciones terminadas en [cursor, xmin),
 * donde xmin es el del snapshot de la PRIMERA página. Si no caben en una página, el servidor
 * devuelve un cursor de continuación que fija ese rango y la posición (tabla y último id):
 *
 *   p.<desde>.<hasta>.<tabla>.<ultimoId>
 *
 * Así una bajada interrumpida se retoma sin perder ni repetir cambios: lo que se modifique mientras
 * tanto obtiene un tx_id >= hasta y llega en la siguiente sincronización.
 */
import type { CambiosPull } from '@micentralmx/shared/api';
import { and, asc, eq, gt, gte, inArray, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { config } from '../../config';
import type { Tx } from '../../db/pool';
import * as t from '../../db/esquema';
import { ErrorHttp } from '../../http/errores';
import * as mapa from '../../lib/mapeo';

interface Posicion {
  desde: string;
  hasta: string;
  tabla: number;
  ultimoId: string | null;
}

const XID = /^\d{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function leerCursor(cursor: string): Posicion | { completo: string } {
  if (XID.test(cursor)) return { completo: cursor };
  const [p, desde, hasta, tabla, ultimoId] = cursor.split('.');
  if (p === 'p' && XID.test(desde) && XID.test(hasta) && /^\d{1,2}$/.test(tabla) && (ultimoId === '' || UUID.test(ultimoId))) {
    return { desde, hasta, tabla: Number(tabla), ultimoId: ultimoId || null };
  }
  throw new ErrorHttp(422, 'Cursor inválido.', 'invalido');
}

const escribirCursor = (p: Posicion) => `p.${p.desde}.${p.hasta}.${p.tabla}.${p.ultimoId ?? ''}`;

interface Fuente {
  nombre: keyof CambiosPull;
  tabla: PgTable;
  clave: AnyColumn;
  tx: AnyColumn;
  /** Filtro adicional de la primera bajada: 30 días más las deudas abiertas (§6). */
  inicial?: (limite: Date) => SQL | undefined;
  mapear: (tx: Tx, filas: never[]) => Promise<unknown[]>;
}

const fuente = <F extends Omit<Fuente, 'mapear'> & { mapear: (tx: Tx, filas: never[]) => Promise<unknown[]> }>(f: F) => f;

/** Orden fijo de las tablas; el cursor de continuación guarda el índice. */
const FUENTES: Fuente[] = [
  fuente({ nombre: 'unidades', tabla: t.unidades, clave: t.unidades.id, tx: t.unidades.txId, mapear: async (_tx, f: (typeof t.unidades.$inferSelect)[]) => f.map(mapa.unidad) }),
  fuente({ nombre: 'productos', tabla: t.productos, clave: t.productos.id, tx: t.productos.txId, mapear: async (_tx, f: (typeof t.productos.$inferSelect)[]) => f.map(mapa.producto) }),
  fuente({ nombre: 'clasificaciones', tabla: t.clasificaciones, clave: t.clasificaciones.id, tx: t.clasificaciones.txId, mapear: async (_tx, f: (typeof t.clasificaciones.$inferSelect)[]) => f.map(mapa.clasificacion) }),
  fuente({ nombre: 'existencias', tabla: t.existencias, clave: t.existencias.clasificacionId, tx: t.existencias.txId, mapear: async (_tx, f: (typeof t.existencias.$inferSelect)[]) => f.map(mapa.existencia) }),
  fuente({ nombre: 'clientes', tabla: t.clientes, clave: t.clientes.id, tx: t.clientes.txId, mapear: async (_tx, f: (typeof t.clientes.$inferSelect)[]) => f.map(mapa.cliente) }),
  fuente({ nombre: 'proveedores', tabla: t.proveedores, clave: t.proveedores.id, tx: t.proveedores.txId, mapear: async (_tx, f: (typeof t.proveedores.$inferSelect)[]) => f.map(mapa.proveedor) }),
  fuente({
    nombre: 'ventas',
    tabla: t.ventas,
    clave: t.ventas.id,
    tx: t.ventas.txId,
    inicial: (limite) =>
      or(gte(t.ventas.creadoEnDispositivo, limite), and(eq(t.ventas.formaPago, 'credito'), sql`${t.ventas.pagado} < ${t.ventas.total}`, sql`${t.ventas.estado} <> 'cancelada'`)),
    mapear: async (tx, f: (typeof t.ventas.$inferSelect)[]) => {
      const r = f.length ? await tx.select().from(t.ventaRenglones).where(inArray(t.ventaRenglones.ventaId, f.map((v) => v.id))).orderBy(asc(t.ventaRenglones.linea)) : [];
      return f.map((v) => mapa.venta(v, r.filter((x) => x.ventaId === v.id).map(mapa.renglonVenta)));
    },
  }),
  fuente({
    nombre: 'pagos',
    tabla: t.pagos,
    clave: t.pagos.id,
    tx: t.pagos.txId,
    inicial: (limite) => gte(t.pagos.creadoEnDispositivo, limite),
    mapear: async (tx, f: (typeof t.pagos.$inferSelect)[]) => {
      const a = f.length ? await tx.select().from(t.pagoAplicaciones).where(inArray(t.pagoAplicaciones.pagoId, f.map((p) => p.id))) : [];
      return f.map((p) => mapa.pago(p, a.filter((x) => x.pagoId === p.id).map((x) => ({ ventaId: x.ventaId, monto: x.monto }))));
    },
  }),
  fuente({
    nombre: 'compras',
    tabla: t.compras,
    clave: t.compras.id,
    tx: t.compras.txId,
    inicial: (limite) => gte(t.compras.creadoEnDispositivo, limite),
    mapear: async (tx, f: (typeof t.compras.$inferSelect)[]) => {
      const r = f.length ? await tx.select().from(t.compraRenglones).where(inArray(t.compraRenglones.compraId, f.map((c) => c.id))).orderBy(asc(t.compraRenglones.linea)) : [];
      return f.map((c) => mapa.compra(c, r.filter((x) => x.compraId === c.id).map(mapa.renglonCompra)));
    },
  }),
  fuente({
    nombre: 'movimientosInventario',
    tabla: t.movimientosInventario,
    clave: t.movimientosInventario.id,
    tx: t.movimientosInventario.txId,
    inicial: (limite) => gte(t.movimientosInventario.creadoEn, limite),
    mapear: async (_tx, f: (typeof t.movimientosInventario.$inferSelect)[]) => f.map(mapa.movimientoInventario),
  }),
  fuente({
    nombre: 'movimientosDinero',
    tabla: t.movimientosDinero,
    clave: t.movimientosDinero.id,
    tx: t.movimientosDinero.txId,
    inicial: (limite) => gte(t.movimientosDinero.creadoEn, limite),
    mapear: async (_tx, f: (typeof t.movimientosDinero.$inferSelect)[]) => f.map(mapa.movimientoDinero),
  }),
];

const vacio = (): CambiosPull => ({
  unidades: [],
  productos: [],
  clasificaciones: [],
  existencias: [],
  clientes: [],
  proveedores: [],
  ventas: [],
  pagos: [],
  compras: [],
  movimientosInventario: [],
  movimientosDinero: [],
});

export async function bajarPagina(tx: Tx, cursor: string, tamano = config.tamanoPaginaBajada): Promise<{ cambios: CambiosPull; cursor: string; hayMas: boolean }> {
  const leido = leerCursor(cursor);
  let pos: Posicion;
  if ('completo' in leido) {
    const { rows } = await tx.execute<{ xmin: string }>(sql`select pg_snapshot_xmin(pg_current_snapshot())::text as xmin`);
    pos = { desde: leido.completo, hasta: rows[0].xmin, tabla: 0, ultimoId: null };
  } else {
    pos = leido;
    if (pos.tabla >= FUENTES.length) throw new ErrorHttp(422, 'Cursor inválido.', 'invalido');
  }
  const inicial = pos.desde === '0';
  const limite = new Date(Date.now() - config.diasRetencion * 86_400_000);
  const cambios = vacio();
  let restante = tamano;

  for (let i = pos.tabla; i < FUENTES.length; i++) {
    const f = FUENTES[i];
    const desdeId = i === pos.tabla ? pos.ultimoId : null;
    const filas = (await tx
      .select()
      .from(f.tabla)
      .where(
        and(
          sql`(${f.tx} >= ${pos.desde}::xid8 and ${f.tx} < ${pos.hasta}::xid8)`,
          desdeId ? gt(f.clave, desdeId) : undefined,
          inicial ? f.inicial?.(limite) : undefined,
        ),
      )
      .orderBy(asc(f.clave))
      .limit(restante + 1)) as Array<Record<string, unknown>>;

    const caben = filas.slice(0, restante);
    (cambios[f.nombre] as unknown[]) = await f.mapear(tx, caben as never[]);
    if (filas.length > restante) {
      const ultimo = caben[caben.length - 1];
      const ultimoId = String(ultimo[f.nombre === 'existencias' ? 'clasificacionId' : 'id']);
      return { cambios, cursor: escribirCursor({ ...pos, tabla: i, ultimoId }), hayMas: true };
    }
    restante -= caben.length;
    if (restante === 0 && i < FUENTES.length - 1) {
      // La página se llenó justo al terminar una tabla: se continúa en la siguiente.
      return { cambios, cursor: escribirCursor({ ...pos, tabla: i + 1, ultimoId: null }), hayMas: true };
    }
  }
  return { cambios, cursor: pos.hasta, hayMas: false };
}
