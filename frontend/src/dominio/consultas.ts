/**
 * Lecturas sobre la base local. Lo que ve el usuario es el snapshot del servidor
 * más las operaciones de este dispositivo que el snapshot todavía no incluye.
 */
import Decimal from 'decimal.js';
import { CONFIG } from '../config';
import type {
  Clasificacion,
  Cliente,
  EstadoVenta,
  Producto,
  Unidad,
} from '@micentralmx/shared/entidades';
import { db, type EstadoSync, type OperacionLocal, type PagoLocal, type VentaLocal } from '../db/db';
import { D, sumar } from '../lib/dinero';
import { diaLocal, diferenciaDias } from '../lib/fechas';
import { folioVenta } from './formato';

/** ¿La operación sigue sin reflejarse en el snapshot del servidor? */
export function operacionVigente(op: OperacionLocal, ultimoPullInicio: string | undefined): boolean {
  if (op.estado === 'rechazada') return false;
  if (op.estado === 'pendiente' || op.estado === 'enviando') return true;
  return !ultimoPullInicio || !op.respondidaEn || op.respondidaEn > ultimoPullInicio;
}

export async function cargarOperaciones() {
  const [ops, ultimoPullInicio] = await Promise.all([db.operaciones.toArray(), db.leerMeta('ultimoPullInicio')]);
  const porId = new Map(ops.map((o) => [o.operacionId, o]));
  const vigentes = new Set(ops.filter((o) => operacionVigente(o, ultimoPullInicio)).map((o) => o.operacionId));
  return { porId, vigentes };
}

// ── Inventario ──────────────────────────────────────────────────────────────

export async function existenciasEfectivas(): Promise<Map<string, Decimal>> {
  const [{ vigentes }, snapshot, locales] = await Promise.all([
    cargarOperaciones(),
    db.existencias.toArray(),
    // Solo los movimientos creados aquí tienen operacionId (los nulos no entran al índice).
    db.movimientosInventario.orderBy('operacionId').toArray(),
  ]);
  const mapa = new Map<string, Decimal>(snapshot.map((e) => [e.clasificacionId, D(e.cantidad)]));
  for (const m of locales) {
    if (!m.operacionId || !vigentes.has(m.operacionId)) continue;
    mapa.set(m.clasificacionId, (mapa.get(m.clasificacionId) ?? D(0)).plus(m.delta));
  }
  return mapa;
}

export interface ClasificacionVista {
  clasificacion: Clasificacion;
  existencia: Decimal;
  bajo: boolean;
  sinExistencia: boolean;
}

export interface ProductoVista {
  producto: Producto;
  unidad: Unidad;
  clasificaciones: ClasificacionVista[];
  total: Decimal;
}

const unidadDesconocida: Unidad = { id: '', nombre: 'unidad', plural: 'unidades', permiteDecimales: true, archivadoEn: null };

export async function catalogo(incluirArchivados = false): Promise<ProductoVista[]> {
  const [productos, clasificaciones, unidades, existencias] = await Promise.all([
    db.productos.toArray(),
    db.clasificaciones.toArray(),
    db.unidades.toArray(),
    existenciasEfectivas(),
  ]);
  const unidadPorId = new Map(unidades.map((u) => [u.id, u]));
  return productos
    .filter((p) => incluirArchivados || !p.archivadoEn)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    .map((producto) => {
      const umbral = D(producto.umbralBajo);
      const clas = clasificaciones
        .filter((c) => c.productoId === producto.id && (incluirArchivados || !c.archivadoEn))
        .sort((a, b) => a.orden - b.orden)
        .map((clasificacion) => {
          const existencia = existencias.get(clasificacion.id) ?? D(0);
          return {
            clasificacion,
            existencia,
            sinExistencia: existencia.lte(0),
            bajo: existencia.gt(0) && existencia.lte(umbral),
          };
        });
      return {
        producto,
        unidad: unidadPorId.get(producto.unidadId) ?? unidadDesconocida,
        clasificaciones: clas,
        total: sumar(clas.map((c) => c.existencia)),
      };
    });
}

// ── Ventas y deudas ─────────────────────────────────────────────────────────

export type EstadoDeuda = 'vencida' | 'proxima' | 'pendiente' | 'pagada';

export interface VentaVista {
  venta: VentaLocal;
  folio: string;
  pagado: Decimal;
  saldo: Decimal;
  estado: EstadoVenta;
  /** Estado de sincronización si aplica: pendiente/enviando = "Sin sincronizar". */
  sync: EstadoSync | null;
  motivoSync: string | null;
  requiereRevision: boolean;
  deuda: EstadoDeuda | null;
}

export function estadoDeuda(venceEl: string | null, saldo: Decimal, hoy = diaLocal()): EstadoDeuda {
  if (saldo.lte(0)) return 'pagada';
  if (!venceEl) return 'pendiente';
  const dif = diferenciaDias(hoy, venceEl);
  if (dif < 0) return 'vencida';
  if (dif <= CONFIG.diasDeudaProxima) return 'proxima';
  return 'pendiente';
}

function aplicacionesLocales(pagos: PagoLocal[], vigentes: Set<string>): Map<string, Decimal> {
  const mapa = new Map<string, Decimal>();
  for (const p of pagos) {
    if (!p.operacionId || !vigentes.has(p.operacionId)) continue;
    for (const a of p.aplicaciones) mapa.set(a.ventaId, (mapa.get(a.ventaId) ?? D(0)).plus(a.monto));
  }
  return mapa;
}

export function vistaVenta(
  venta: VentaLocal,
  aplicadoLocal: Decimal,
  ops: Map<string, OperacionLocal>,
): VentaVista {
  const pagado = D(venta.pagado).plus(aplicadoLocal);
  const saldo = venta.estado === 'cancelada' ? D(0) : Decimal.max(D(venta.total).minus(pagado), 0);
  let estado: EstadoVenta = venta.estado;
  if (venta.formaPago === 'credito' && estado !== 'cancelada') estado = saldo.gt(0) ? 'a_credito' : 'completada';
  const op = venta.operacionId ? ops.get(venta.operacionId) : undefined;
  const sync = op && op.estado !== 'sincronizada' ? op.estado : venta.requiereRevision ? 'en_revision' : null;
  return {
    venta,
    folio: folioVenta(venta),
    pagado,
    saldo,
    estado,
    sync,
    motivoSync: op?.motivo ?? venta.motivoRevision,
    requiereRevision: venta.requiereRevision || op?.estado === 'en_revision',
    deuda: venta.formaPago === 'credito' && estado !== 'cancelada' ? estadoDeuda(venta.venceEl, saldo) : null,
  };
}

export async function ventasVista(): Promise<VentaVista[]> {
  const [ventas, pagos, { porId, vigentes }] = await Promise.all([
    db.ventas.orderBy('creadoEnDispositivo').reverse().toArray(),
    db.pagos.toArray(),
    cargarOperaciones(),
  ]);
  const aplicado = aplicacionesLocales(pagos, vigentes);
  return ventas
    .filter((v) => !(v.operacionId && porId.get(v.operacionId)?.estado === 'rechazada'))
    .map((v) => vistaVenta(v, aplicado.get(v.id) ?? D(0), porId));
}

export async function ventaVista(id: string): Promise<VentaVista | null> {
  const venta = await db.ventas.get(id);
  if (!venta) return null;
  const [pagos, { porId, vigentes }] = await Promise.all([db.pagos.toArray(), cargarOperaciones()]);
  return vistaVenta(venta, aplicacionesLocales(pagos, vigentes).get(id) ?? D(0), porId);
}

/** Deudas: ventas a crédito no canceladas. */
export async function deudasVista(): Promise<VentaVista[]> {
  return (await ventasVista()).filter((v) => v.deuda !== null);
}

/** Deudas abiertas de un cliente en orden de cobro: primero la que vence antes. */
export function ordenCobro(deudas: VentaVista[]): VentaVista[] {
  return deudas
    .filter((d) => d.saldo.gt(0))
    .sort(
      (a, b) =>
        (a.venta.venceEl ?? '9999').localeCompare(b.venta.venceEl ?? '9999') ||
        a.venta.creadoEnDispositivo.localeCompare(b.venta.creadoEnDispositivo),
    );
}

// ── Clientes ────────────────────────────────────────────────────────────────

export type EstadoCliente = 'vencida' | 'proxima' | 'al_corriente' | 'sin_saldo';

export interface ClienteVista {
  cliente: Cliente & { operacionId?: string | null };
  saldo: Decimal;
  estado: EstadoCliente;
  deudasAbiertas: VentaVista[];
  ultimaCompra: string | null;
  sync: EstadoSync | null;
}

export async function clientesVista(): Promise<ClienteVista[]> {
  const [clientes, ventas, { porId }] = await Promise.all([db.clientes.toArray(), ventasVista(), cargarOperaciones()]);
  return clientes
    .filter((c) => !c.archivadoEn && !(c.operacionId && porId.get(c.operacionId)?.estado === 'rechazada'))
    .map((cliente) => {
      const suyas = ventas.filter((v) => v.venta.clienteId === cliente.id);
      const abiertas = ordenCobro(suyas.filter((v) => v.deuda && v.deuda !== 'pagada'));
      const saldo = sumar(abiertas.map((d) => d.saldo));
      const estado: EstadoCliente = abiertas.some((d) => d.deuda === 'vencida')
        ? 'vencida'
        : abiertas.some((d) => d.deuda === 'proxima')
          ? 'proxima'
          : saldo.gt(0)
            ? 'al_corriente'
            : 'sin_saldo';
      const op = cliente.operacionId ? porId.get(cliente.operacionId) : undefined;
      return {
        cliente,
        saldo,
        estado,
        deudasAbiertas: abiertas,
        ultimaCompra: suyas.find((v) => v.estado !== 'cancelada')?.venta.creadoEnDispositivo ?? null,
        sync: op && op.estado !== 'sincronizada' ? op.estado : cliente.requiereRevision ? 'en_revision' : null,
      };
    })
    .sort((a, b) => a.cliente.nombre.localeCompare(b.cliente.nombre, 'es'));
}

// ── Pagos, compras y movimientos de dinero ──────────────────────────────────

export async function syncDe(operacionId: string | null | undefined): Promise<EstadoSync | null> {
  if (!operacionId) return null;
  const op = await db.operaciones.get(operacionId);
  return op && op.estado !== 'sincronizada' ? op.estado : null;
}

export function sincronizacionDe(ops: Map<string, OperacionLocal>, operacionId: string | null | undefined) {
  const op = operacionId ? ops.get(operacionId) : undefined;
  return op && op.estado !== 'sincronizada' ? op.estado : null;
}

export const descripcionFolio = (v: VentaLocal) => `Venta ${folioVenta(v)}`;
