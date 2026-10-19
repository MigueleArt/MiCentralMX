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
  Proveedor,
  Unidad,
  Liquidacion,
} from '@micentralmx/shared/entidades';
import { db, type CargaLocal, type EstadoSync, type OperacionLocal, type PagoLocal, type VentaLocal } from '../db/db';
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

// ── Inventario y Cargas ────────────────────────────────────────────────────

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

export async function existenciasCargaEfectivas(): Promise<Map<string, Decimal>> {
  const [{ vigentes }, snapshot, locales] = await Promise.all([
    cargarOperaciones(),
    db.existenciasCarga.toArray(),
    db.movimientosInventario.orderBy('operacionId').toArray(),
  ]);
  const mapa = new Map<string, Decimal>();
  for (const ec of snapshot) {
    mapa.set(`${ec.cargaId}:${ec.clasificacionId}`, D(ec.cantidad));
  }
  for (const m of locales) {
    if (!m.operacionId || !vigentes.has(m.operacionId) || !m.cargaId) continue;
    const clave = `${m.cargaId}:${m.clasificacionId}`;
    mapa.set(clave, (mapa.get(clave) ?? D(0)).plus(m.delta));
  }
  return mapa;
}

export interface CargaConDetalle {
  carga: CargaLocal;
  proveedorNombre: string;
  proveedorTipo: 'tercero' | 'rancho_propio';
  existencias: Map<string, Decimal>;
}

export async function cargasAbiertas(): Promise<CargaConDetalle[]> {
  const [cargas, proveedores, existencias] = await Promise.all([
    db.cargas.toArray(),
    db.proveedores.toArray(),
    existenciasCargaEfectivas(),
  ]);
  const provMap = new Map(proveedores.map((p) => [p.id, p]));
  const abiertas = cargas.filter((c) => c.estado === 'abierta');
  abiertas.sort((a, b) => {
    const fComp = a.fecha.localeCompare(b.fecha);
    if (fComp !== 0) return fComp;
    return a.creadoEnDispositivo.localeCompare(b.creadoEnDispositivo);
  });

  return abiertas.map((c) => {
    const p = provMap.get(c.proveedorId);
    const exMap = new Map<string, Decimal>();
    for (const r of c.renglones) {
      const cant = existencias.get(`${c.id}:${r.clasificacionId}`) ?? D(0);
      exMap.set(r.clasificacionId, cant);
    }
    return {
      carga: c,
      proveedorNombre: p?.nombre ?? 'Proveedor',
      proveedorTipo: p?.tipo ?? 'tercero',
      existencias: exMap,
    };
  });
}

export interface AsignacionRenglon {
  cargaId: string | null;
  origenNombre: string;
  cantidad: string;
}

export async function asignarCargaRenglon(
  clasificacionId: string,
  cantidad: string,
  cargaIdPreferencia?: string | null,
): Promise<AsignacionRenglon[]> {
  const pedida = D(cantidad);
  if (pedida.lte(0)) return [];

  const abiertas = await cargasAbiertas();
  const conStock = abiertas.filter((c) => (c.existencias.get(clasificacionId) ?? D(0)).gt(0));

  if (conStock.length === 0) {
    return [{ cargaId: null, origenNombre: 'Inventario general', cantidad: pedida.toString() }];
  }

  if (cargaIdPreferencia) {
    const idx = conStock.findIndex((c) => c.carga.id === cargaIdPreferencia);
    if (idx > 0) {
      const preferida = conStock.splice(idx, 1)[0];
      conStock.unshift(preferida);
    }
  }

  const resultado: AsignacionRenglon[] = [];
  let restante = pedida;

  for (const c of conStock) {
    if (restante.lte(0)) break;
    const disponible = c.existencias.get(clasificacionId) ?? D(0);
    const tomar = Decimal.min(restante, disponible);
    if (tomar.gt(0)) {
      resultado.push({
        cargaId: c.carga.id,
        origenNombre: c.proveedorNombre,
        cantidad: tomar.toString(),
      });
      restante = restante.minus(tomar);
    }
  }

  if (restante.gt(0)) {
    resultado.push({
      cargaId: null,
      origenNombre: 'Inventario general',
      cantidad: restante.toString(),
    });
  }

  return resultado;
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

// ── Vistas de Cargas del día ───────────────────────────────────────────────

export interface RenglonCargaDetalle {
  clasificacionId: string;
  productoNombre: string;
  clasificacionNombre: string;
  unidadNombre: string;
  unidadPlural: string;
  cargado: Decimal;
  vendido: Decimal;
  merma: Decimal;
  devolucion: Decimal;
  queda: Decimal;
}

export interface VentaCargaResumen {
  venta: VentaLocal;
  clienteNombre: string;
  total: Decimal;
  cantidadTotalCarga: Decimal;
  creadoEnDispositivo: string;
}

export interface CargaDetalleVista {
  carga: CargaLocal;
  proveedorNombre: string;
  proveedorTipo: 'tercero' | 'rancho_propio';
  renglones: RenglonCargaDetalle[];
  totalCargado: Decimal;
  totalVendido: Decimal;
  totalMerma: Decimal;
  totalDevolucion: Decimal;
  totalQueda: Decimal;
  ventas: VentaCargaResumen[];
  sync: EstadoSync | null;
}

export interface CargaResumenVista {
  carga: CargaLocal;
  proveedorNombre: string;
  proveedorTipo: 'tercero' | 'rancho_propio';
  totalCargado: Decimal;
  totalVendido: Decimal;
  totalQueda: Decimal;
  sync: EstadoSync | null;
}

export interface TotalesCargaDia {
  cargado: Decimal;
  vendido: Decimal;
  queda: Decimal;
  porClasificacion: Array<{
    clasificacionId: string;
    productoNombre: string;
    clasificacionNombre: string;
    unidadPlural: string;
    cargado: Decimal;
    vendido: Decimal;
    queda: Decimal;
  }>;
  porOrigen: Array<{
    proveedorId: string;
    proveedorNombre: string;
    proveedorTipo: 'tercero' | 'rancho_propio';
    cargado: Decimal;
    vendido: Decimal;
    queda: Decimal;
  }>;
  cargas: CargaResumenVista[];
}

export async function detalleCargaVista(id: string): Promise<CargaDetalleVista | null> {
  const [carga, proveedores, productos, clasificaciones, unidades, existenciasCarga, movimientos, ventas, { porId }] = await Promise.all([
    db.cargas.get(id),
    db.proveedores.toArray(),
    db.productos.toArray(),
    db.clasificaciones.toArray(),
    db.unidades.toArray(),
    existenciasCargaEfectivas(),
    db.movimientosInventario.toArray(),
    ventasVista(),
    cargarOperaciones(),
  ]);
  if (!carga) return null;

  const prov = proveedores.find((p) => p.id === carga.proveedorId);
  const clasMap = new Map(clasificaciones.map((c) => [c.id, c]));
  const prodMap = new Map(productos.map((p) => [p.id, p]));
  const unitMap = new Map(unidades.map((u) => [u.id, u]));

  // Movimientos de esta carga
  const movsCarga = movimientos.filter((m) => m.cargaId === carga.id);

  // Ventas asociadas a esta carga
  const ventasCarga = ventas.filter((v) => v.venta.renglones.some((r) => r.cargaId === carga.id));

  const renglones: RenglonCargaDetalle[] = carga.renglones.map((r) => {
    const c = clasMap.get(r.clasificacionId);
    const p = c ? prodMap.get(c.productoId) : undefined;
    const u = p ? unitMap.get(p.unidadId) : undefined;

    const cargado = D(r.cantidad);
    const queda = existenciasCarga.get(`${carga.id}:${r.clasificacionId}`) ?? D(0);

    let vendido = D(0);
    for (const v of ventasCarga) {
      for (const vr of v.venta.renglones) {
        if (vr.cargaId === carga.id && vr.clasificacionId === r.clasificacionId) {
          vendido = vendido.plus(vr.cantidad);
        }
      }
    }

    let merma = D(0);
    let devolucion = D(0);
    for (const m of movsCarga) {
      if (m.clasificacionId === r.clasificacionId) {
        if (m.tipo === 'merma') merma = merma.plus(D(m.delta).abs());
        if (m.tipo === 'devolucion') devolucion = devolucion.plus(D(m.delta).abs());
      }
    }

    return {
      clasificacionId: r.clasificacionId,
      productoNombre: p?.nombre ?? 'Producto',
      clasificacionNombre: c?.nombre ?? 'Clasificación',
      unidadNombre: u?.nombre ?? 'unidad',
      unidadPlural: u?.plural ?? 'unidades',
      cargado,
      vendido,
      merma,
      devolucion,
      queda,
    };
  });

  const op = carga.operacionId ? porId.get(carga.operacionId) : undefined;
  const sync = op && op.estado !== 'sincronizada' ? op.estado : null;

  const ventasResumen: VentaCargaResumen[] = ventasCarga.map((v) => {
    let cantCarga = D(0);
    for (const vr of v.venta.renglones) {
      if (vr.cargaId === carga.id) {
        cantCarga = cantCarga.plus(vr.cantidad);
      }
    }
    return {
      venta: v.venta,
      clienteNombre: v.venta.clienteNombre ?? 'Público general',
      total: D(v.venta.total),
      cantidadTotalCarga: cantCarga,
      creadoEnDispositivo: v.venta.creadoEnDispositivo,
    };
  });

  return {
    carga,
    proveedorNombre: prov?.nombre ?? 'Proveedor',
    proveedorTipo: prov?.tipo ?? 'tercero',
    renglones,
    totalCargado: sumar(renglones.map((r) => r.cargado)),
    totalVendido: sumar(renglones.map((r) => r.vendido)),
    totalMerma: sumar(renglones.map((r) => r.merma)),
    totalDevolucion: sumar(renglones.map((r) => r.devolucion)),
    totalQueda: sumar(renglones.map((r) => r.queda)),
    ventas: ventasResumen,
    sync,
  };
}

export async function totalesCargaDelDia(fecha = diaLocal()): Promise<TotalesCargaDia> {
  const [cargas, proveedores, productos, clasificaciones, unidades, existenciasCarga, ventas, { porId }] = await Promise.all([
    db.cargas.toArray(),
    db.proveedores.toArray(),
    db.productos.toArray(),
    db.clasificaciones.toArray(),
    db.unidades.toArray(),
    existenciasCargaEfectivas(),
    ventasVista(),
    cargarOperaciones(),
  ]);

  const delDia = cargas.filter((c) => c.fecha === fecha);
  const provMap = new Map(proveedores.map((p) => [p.id, p]));
  const clasMap = new Map(clasificaciones.map((c) => [c.id, c]));
  const prodMap = new Map(productos.map((p) => [p.id, p]));
  const unitMap = new Map(unidades.map((u) => [u.id, u]));

  const resumenCargas: CargaResumenVista[] = delDia.map((c) => {
    const prov = provMap.get(c.proveedorId);
    let cargado = D(0);
    let queda = D(0);
    for (const r of c.renglones) {
      cargado = cargado.plus(r.cantidad);
      queda = queda.plus(existenciasCarga.get(`${c.id}:${r.clasificacionId}`) ?? D(0));
    }
    let vendido = D(0);
    for (const v of ventas) {
      for (const vr of v.venta.renglones) {
        if (vr.cargaId === c.id) vendido = vendido.plus(vr.cantidad);
      }
    }
    const op = c.operacionId ? porId.get(c.operacionId) : undefined;
    return {
      carga: c,
      proveedorNombre: prov?.nombre ?? 'Proveedor',
      proveedorTipo: prov?.tipo ?? 'tercero',
      totalCargado: cargado,
      totalVendido: vendido,
      totalQueda: queda,
      sync: op && op.estado !== 'sincronizada' ? op.estado : null,
    };
  });

  const porClasMap = new Map<string, { cargado: Decimal; vendido: Decimal; queda: Decimal }>();
  for (const c of delDia) {
    for (const r of c.renglones) {
      const cur = porClasMap.get(r.clasificacionId) ?? { cargado: D(0), vendido: D(0), queda: D(0) };
      cur.cargado = cur.cargado.plus(r.cantidad);
      cur.queda = cur.queda.plus(existenciasCarga.get(`${c.id}:${r.clasificacionId}`) ?? D(0));
      porClasMap.set(r.clasificacionId, cur);
    }
  }
  for (const v of ventas) {
    for (const vr of v.venta.renglones) {
      if (vr.cargaId && delDia.some((c) => c.id === vr.cargaId)) {
        const cur = porClasMap.get(vr.clasificacionId) ?? { cargado: D(0), vendido: D(0), queda: D(0) };
        cur.vendido = cur.vendido.plus(vr.cantidad);
        porClasMap.set(vr.clasificacionId, cur);
      }
    }
  }

  const porClasificacion = [...porClasMap.entries()].map(([clasId, totals]) => {
    const c = clasMap.get(clasId);
    const p = c ? prodMap.get(c.productoId) : undefined;
    const u = p ? unitMap.get(p.unidadId) : undefined;
    return {
      clasificacionId: clasId,
      productoNombre: p?.nombre ?? 'Producto',
      clasificacionNombre: c?.nombre ?? 'Clasificación',
      unidadPlural: u?.plural ?? 'unidades',
      ...totals,
    };
  });

  const porOrigenMap = new Map<string, { cargado: Decimal; vendido: Decimal; queda: Decimal }>();
  for (const c of delDia) {
    const cur = porOrigenMap.get(c.proveedorId) ?? { cargado: D(0), vendido: D(0), queda: D(0) };
    for (const r of c.renglones) {
      cur.cargado = cur.cargado.plus(r.cantidad);
      cur.queda = cur.queda.plus(existenciasCarga.get(`${c.id}:${r.clasificacionId}`) ?? D(0));
    }
    porOrigenMap.set(c.proveedorId, cur);
  }
  for (const v of ventas) {
    for (const vr of v.venta.renglones) {
      if (vr.cargaId) {
        const c = delDia.find((x) => x.id === vr.cargaId);
        if (c) {
          const cur = porOrigenMap.get(c.proveedorId) ?? { cargado: D(0), vendido: D(0), queda: D(0) };
          cur.vendido = cur.vendido.plus(vr.cantidad);
          porOrigenMap.set(c.proveedorId, cur);
        }
      }
    }
  }

  const porOrigen = [...porOrigenMap.entries()].map(([provId, totals]) => {
    const p = provMap.get(provId);
    return {
      proveedorId: provId,
      proveedorNombre: p?.nombre ?? 'Proveedor',
      proveedorTipo: p?.tipo ?? 'tercero',
      ...totals,
    };
  });

  return {
    cargado: sumar(resumenCargas.map((c) => c.totalCargado)),
    vendido: sumar(resumenCargas.map((c) => c.totalVendido)),
    queda: sumar(resumenCargas.map((c) => c.totalQueda)),
    porClasificacion,
    porOrigen,
    cargas: resumenCargas,
  };
}

// ── Estado de cuenta y saldos de productores ───────────────────────────────

export interface SaldoProductorVista {
  proveedorId: string;
  nombre: string;
  tipo: 'tercero' | 'rancho_propio';
  telefono: string | null;
  totalLiquidado: Decimal;
  totalAjustes: Decimal;
  totalPagado: Decimal;
  totalAnticipos: Decimal;
  saldo: Decimal;
}

export type EstadoCorte = 'pendiente' | 'parcial' | 'pagado';

export interface MovimientoEstadoCuentaProductor {
  id: string;
  fecha: string;
  tipo: 'corte' | 'pago' | 'anticipo' | 'cargo' | 'abono';
  folio?: number | null;
  concepto: string;
  cargo: Decimal;
  abono: Decimal;
  saldoCorrido: Decimal;
  estadoCorte?: EstadoCorte;
  montoCubierto?: Decimal;
  referenciaId?: string;
  raw?: unknown;
}

export interface EstadoCuentaProductorVista {
  proveedor: Proveedor;
  saldo: Decimal;
  totalLiquidado: Decimal;
  totalAjustes: Decimal;
  totalPagos: Decimal;
  totalAnticipos: Decimal;
  movimientos: MovimientoEstadoCuentaProductor[];
  items: MovimientoEstadoCuentaProductor[];
  cortes: Array<{
    liquidacion: Liquidacion;
    estado: EstadoCorte;
    montoCubierto: Decimal;
    saldoRestante: Decimal;
  }>;
}

export async function saldosProductoresLocales(): Promise<SaldoProductorVista[]> {
  const [proveedores, liquidaciones, ajustes, movimientos, { porId }] = await Promise.all([
    db.proveedores.toArray(),
    db.liquidaciones.toArray(),
    db.ajustesProductor.toArray(),
    db.movimientosDinero.toArray(),
    cargarOperaciones(),
  ]);

  return proveedores.map((p) => {
    if (p.tipo === 'rancho_propio') {
      return {
        proveedorId: p.id,
        nombre: p.nombre,
        tipo: p.tipo,
        telefono: p.telefono,
        totalLiquidado: D(0),
        totalAjustes: D(0),
        totalPagado: D(0),
        totalAnticipos: D(0),
        saldo: D(0),
      };
    }

    const provLiqs = liquidaciones.filter((l) => l.proveedorId === p.id);
    const provAjustes = ajustes.filter((a) => a.proveedorId === p.id);
    const provMovs = movimientos.filter(
      (m) =>
        m.proveedorId === p.id &&
        (m.categoria === 'pago_proveedor' || m.categoria === 'anticipo_productor') &&
        !m.compraId &&
        !m.concepto?.toLowerCase().includes('compra') &&
        (!m.operacionId || porId.get(m.operacionId)?.estado !== 'rechazada'),
    );

    const totalLiquidado = sumar(provLiqs.map((l) => l.neto));
    const abonos = sumar(provAjustes.filter((a) => a.tipo === 'abono').map((a) => a.monto));
    const cargos = sumar(provAjustes.filter((a) => a.tipo === 'cargo').map((a) => a.monto));
    const totalAjustes = abonos.minus(cargos);
    const totalPagado = sumar(provMovs.filter((m) => m.categoria === 'pago_proveedor').map((m) => m.monto));
    const totalAnticipos = sumar(provMovs.filter((m) => m.categoria === 'anticipo_productor').map((m) => m.monto));
    const saldo = totalLiquidado.plus(totalAjustes).minus(totalPagado).minus(totalAnticipos);

    return {
      proveedorId: p.id,
      nombre: p.nombre,
      tipo: p.tipo,
      telefono: p.telefono,
      totalLiquidado,
      totalAjustes,
      totalPagado,
      totalAnticipos,
      saldo,
    };
  });
}

export async function estadoCuentaProductorLocal(proveedorId: string): Promise<EstadoCuentaProductorVista> {
  const [proveedor, liquidaciones, ajustes, movimientos, { porId }] = await Promise.all([
    db.proveedores.get(proveedorId),
    db.liquidaciones.where('proveedorId').equals(proveedorId).toArray(),
    db.ajustesProductor.where('proveedorId').equals(proveedorId).toArray(),
    db.movimientosDinero.toArray(),
    cargarOperaciones(),
  ]);

  if (!proveedor) {
    throw new Error('Proveedor no encontrado.');
  }

  const provMovs = movimientos.filter(
    (m) =>
      m.proveedorId === proveedorId &&
      (m.categoria === 'pago_proveedor' || m.categoria === 'anticipo_productor') &&
      !m.compraId &&
      !m.concepto?.toLowerCase().includes('compra') &&
      (!m.operacionId || porId.get(m.operacionId)?.estado !== 'rechazada'),
  );

  const totalLiquidado = sumar(liquidaciones.map((l) => l.neto));
  const abonos = sumar(ajustes.filter((a) => a.tipo === 'abono').map((a) => a.monto));
  const cargos = sumar(ajustes.filter((a) => a.tipo === 'cargo').map((a) => a.monto));
  const totalAjustes = abonos.minus(cargos);
  const totalPagado = sumar(provMovs.filter((m) => m.categoria === 'pago_proveedor').map((m) => m.monto));
  const totalAnticipos = sumar(provMovs.filter((m) => m.categoria === 'anticipo_productor').map((m) => m.monto));
  const saldo = totalLiquidado.plus(totalAjustes).minus(totalPagado).minus(totalAnticipos);

  // Cortes FIFO
  const liquidacionesOrdenadas = [...liquidaciones].sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
  let pagosRestantes = totalPagado.plus(totalAnticipos);
  const cortesInfoMap = new Map<string, { estado: EstadoCorte; montoCubierto: Decimal; saldoRestante: Decimal }>();

  const cortes = liquidacionesOrdenadas.map((l) => {
    const neto = D(l.neto);
    let estado: EstadoCorte = 'pendiente';
    let montoCubierto = D(0);
    let saldoRestante = neto;

    if (pagosRestantes.gte(neto)) {
      estado = 'pagado';
      montoCubierto = neto;
      saldoRestante = D(0);
      pagosRestantes = pagosRestantes.minus(neto);
    } else if (pagosRestantes.gt(0)) {
      estado = 'parcial';
      montoCubierto = pagosRestantes;
      saldoRestante = neto.minus(pagosRestantes);
      pagosRestantes = D(0);
    }

    const info = { estado, montoCubierto, saldoRestante };
    cortesInfoMap.set(l.id, info);
    return {
      liquidacion: l,
      ...info,
    };
  });

  // Movimientos unificados
  const items: MovimientoEstadoCuentaProductor[] = [];

  for (const l of liquidaciones) {
    const cInfo = cortesInfoMap.get(l.id);
    items.push({
      id: l.id,
      fecha: l.creadoEn,
      tipo: 'corte',
      folio: l.folio,
      concepto: `Corte #${l.folio ?? ''}`,
      cargo: D(0),
      abono: D(l.neto),
      saldoCorrido: D(0),
      estadoCorte: cInfo?.estado,
      montoCubierto: cInfo?.montoCubierto,
      referenciaId: l.id,
      raw: l,
    });
  }

  for (const a of ajustes) {
    const isAbono = a.tipo === 'abono';
    items.push({
      id: a.id,
      fecha: a.creadoEn,
      tipo: isAbono ? 'abono' : 'cargo',
      concepto: `Ajuste (${a.categoria}): ${a.concepto}`,
      cargo: isAbono ? D(0) : D(a.monto),
      abono: isAbono ? D(a.monto) : D(0),
      saldoCorrido: D(0),
      referenciaId: a.id,
      raw: a,
    });
  }

  for (const m of provMovs) {
    const isAnticipo = m.categoria === 'anticipo_productor';
    const esPendiente = Boolean(m.operacionId && porId.get(m.operacionId)?.estado === 'pendiente');
    items.push({
      id: m.id,
      fecha: m.creadoEn,
      tipo: isAnticipo ? 'anticipo' : 'pago',
      concepto: esPendiente ? `${m.concepto} (pendiente)` : m.concepto,
      cargo: D(m.monto),
      abono: D(0),
      saldoCorrido: D(0),
      referenciaId: m.id,
      raw: m,
    });
  }

  items.sort((a, b) => a.fecha.localeCompare(b.fecha));

  let corrido = D(0);
  for (const it of items) {
    corrido = corrido.plus(it.abono).minus(it.cargo);
    it.saldoCorrido = corrido;
  }

  return {
    proveedor,
    saldo,
    totalLiquidado,
    totalAjustes,
    totalPagos: totalPagado,
    totalAnticipos,
    movimientos: items,
    items,
    cortes,
  };
}

