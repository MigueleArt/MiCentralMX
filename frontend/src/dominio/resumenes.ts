/**
 * Indicadores de Inicio, Ventas, Deudas y Pagos calculados sobre los datos locales
 * (decisiones técnicas §6). Muestran lo que sabe este dispositivo a la hora de la última bajada.
 */
import type Decimal from 'decimal.js';
import type { MetodoPago } from '@micentralmx/shared/entidades';
import { db, type PagoLocal } from '../db/db';
import { D, sumar } from '../lib/dinero';
import { diaLocal } from '../lib/fechas';
import {
  cargarOperaciones,
  catalogo,
  deudasVista,
  ordenCobro,
  sincronizacionDe,
  ventasVista,
  type ClienteVista,
  type VentaVista,
} from './consultas';
import { cantidadConUnidad, ETIQUETA_FORMA_PAGO, ETIQUETA_METODO, folioCompra } from './formato';

export type TipoMovimiento = 'venta' | 'credito' | 'compra' | 'pago' | 'merma' | 'ingreso' | 'egreso';

export interface MovimientoReciente {
  id: string;
  tipo: TipoMovimiento;
  titulo: string;
  detalle: string;
  /** Importe con signo; null si no aplica (mermas). */
  monto: Decimal | null;
  textoMonto?: string;
  fecha: string;
  ruta: string;
}

const esHoy = (iso: string) => diaLocal(iso) === diaLocal();

export function resumenVentas(ventas: VentaVista[], dia = diaLocal()) {
  const delDia = ventas.filter((v) => diaLocal(v.venta.creadoEnDispositivo) === dia && v.estado !== 'cancelada');
  const credito = delDia.filter((v) => v.venta.formaPago === 'credito');
  return {
    total: sumar(delDia.map((v) => v.venta.total)),
    cantidad: delDia.length,
    contado: delDia.length - credito.length,
    aCredito: credito.length,
    totalCredito: sumar(credito.map((v) => v.venta.total)),
    porCobrarDelDia: sumar(credito.map((v) => v.saldo)),
  };
}

export function resumenDeudas(deudas: VentaVista[]) {
  const abiertas = deudas.filter((d) => d.saldo.gt(0));
  const de = (e: string) => abiertas.filter((d) => d.deuda === e);
  const mes = diaLocal().slice(0, 7);
  const pagadasMes = deudas.filter((d) => d.deuda === 'pagada' && diaLocal(d.venta.creadoEnDispositivo).slice(0, 7) === mes);
  return {
    porCobrar: sumar(abiertas.map((d) => d.saldo)),
    clientes: new Set(abiertas.map((d) => d.venta.clienteId)).size,
    vencidas: de('vencida'),
    proximas: de('proxima'),
    pendientes: de('pendiente'),
    totalVencido: sumar(de('vencida').map((d) => d.saldo)),
    totalProximo: sumar(de('proxima').map((d) => d.saldo)),
    pagadasMes,
    totalPagadoMes: sumar(pagadasMes.map((d) => d.pagado)),
  };
}

export interface ResumenAbonos {
  abonadoHoy: Decimal;
  cantidadHoy: number;
  abonadoMes: Decimal;
  cantidadMes: number;
  recientes: PagoLocal[];
}

export function resumenAbonos(
  pagos: PagoLocal[],
  rechazadas = new Set<string>(),
  hoy = diaLocal(),
): ResumenAbonos {
  const validos = pagos
    .filter((p) => !(p.operacionId && rechazadas.has(p.operacionId)))
    .sort((a, b) => b.creadoEnDispositivo.localeCompare(a.creadoEnDispositivo));
  const mes = hoy.slice(0, 7);
  const delDia = validos.filter((p) => diaLocal(p.creadoEnDispositivo) === hoy);
  const delMes = validos.filter((p) => diaLocal(p.creadoEnDispositivo).slice(0, 7) === mes);
  return {
    abonadoHoy: sumar(delDia.map((p) => p.monto)),
    cantidadHoy: delDia.length,
    abonadoMes: sumar(delMes.map((p) => p.monto)),
    cantidadMes: delMes.length,
    recientes: validos.slice(0, 10),
  };
}

export interface DeudaClienteResumen {
  clienteId: string;
  clienteNombre: string;
  telefono: string | null;
  ubicacion: string | null;
  saldoTotal: Decimal;
  totalOriginal: Decimal;
  totalAbonado: Decimal;
  cantidadDeudas: number;
  deudasAbiertas: VentaVista[];
  estado: 'vencida' | 'proxima' | 'pendiente';
  proximoVencimiento: string | null;
  ultimoAbono: { fecha: string; monto: string; metodo: MetodoPago } | null;
}

/** Agrupa deudas abiertas por cliente para control sencillo tipo libreta. */
export function agruparDeudasPorCliente(
  deudas: VentaVista[],
  clientes: ClienteVista[],
  pagos: PagoLocal[],
  rechazadas = new Set<string>(),
): DeudaClienteResumen[] {
  const mapaDeudas = new Map<string, VentaVista[]>();
  for (const d of deudas) {
    if (d.saldo.lte(0) || !d.venta.clienteId) continue;
    const lista = mapaDeudas.get(d.venta.clienteId) ?? [];
    lista.push(d);
    mapaDeudas.set(d.venta.clienteId, lista);
  }

  const mapaClientes = new Map(clientes.map((c) => [c.cliente.id, c]));
  const ultimoPagoPorCliente = new Map<string, PagoLocal>();
  const pagosOrdenados = [...pagos]
    .filter((p) => !(p.operacionId && rechazadas.has(p.operacionId)))
    .sort((a, b) => b.creadoEnDispositivo.localeCompare(a.creadoEnDispositivo));
  for (const p of pagosOrdenados) {
    if (!ultimoPagoPorCliente.has(p.clienteId)) {
      ultimoPagoPorCliente.set(p.clienteId, p);
    }
  }

  const prioridadEstado: Record<DeudaClienteResumen['estado'], number> = {
    vencida: 0,
    proxima: 1,
    pendiente: 2,
  };

  const lista: DeudaClienteResumen[] = [];
  for (const [clienteId, grupo] of mapaDeudas) {
    const ordenadas = ordenCobro(grupo);
    const cli = mapaClientes.get(clienteId);
    const estado: DeudaClienteResumen['estado'] = ordenadas.some((d) => d.deuda === 'vencida')
      ? 'vencida'
      : ordenadas.some((d) => d.deuda === 'proxima')
        ? 'proxima'
        : 'pendiente';
    const ult = ultimoPagoPorCliente.get(clienteId);
    lista.push({
      clienteId,
      clienteNombre: cli?.cliente.nombre ?? ordenadas[0]?.venta.clienteNombre ?? 'Cliente',
      telefono: cli?.cliente.telefono ?? null,
      ubicacion: cli?.cliente.ubicacion ?? null,
      saldoTotal: sumar(ordenadas.map((d) => d.saldo)),
      totalOriginal: sumar(ordenadas.map((d) => d.venta.total)),
      totalAbonado: sumar(ordenadas.map((d) => d.pagado)),
      cantidadDeudas: ordenadas.length,
      deudasAbiertas: ordenadas,
      estado,
      proximoVencimiento: ordenadas.find((d) => d.venta.venceEl)?.venta.venceEl ?? null,
      ultimoAbono: ult ? { fecha: ult.creadoEnDispositivo, monto: ult.monto, metodo: ult.metodo } : null,
    });
  }

  return lista.sort(
    (a, b) =>
      prioridadEstado[a.estado] - prioridadEstado[b.estado] ||
      b.saldoTotal.comparedTo(a.saldoTotal),
  );
}

export async function inventarioBajo() {
  const productos = await catalogo();
  return productos.flatMap((p) =>
    p.clasificaciones
      .filter((c) => c.bajo || c.sinExistencia)
      .map((c) => ({
        productoId: p.producto.id,
        nombre: `${p.producto.nombre} · ${c.clasificacion.nombre.split(' / ')[0]}`,
        cantidad: cantidadConUnidad(c.existencia.toString(), p.unidad),
        sinExistencia: c.sinExistencia,
      })),
  );
}

/** Movimientos de ventas, compras, pagos, mermas e ingresos/egresos, más recientes primero. */
export async function movimientosRecientes(limite = 6): Promise<MovimientoReciente[]> {
  const [ventas, compras, pagos, mermas, dinero, productos, { porId }] = await Promise.all([
    ventasVista(),
    db.compras.orderBy('creadoEnDispositivo').reverse().limit(limite).toArray(),
    db.pagos.orderBy('creadoEnDispositivo').reverse().limit(limite).toArray(),
    db.movimientosInventario.where('creadoEn').above('').reverse().filter((m) => m.tipo === 'merma').limit(limite).toArray(),
    db.movimientosDinero.orderBy('creadoEn').reverse().limit(limite).toArray(),
    catalogo(true),
    cargarOperaciones(),
  ]);
  const rechazada = (id: string | null | undefined) => sincronizacionDe(porId, id) === 'rechazada';
  const lista: MovimientoReciente[] = [
    ...ventas
      .filter((v) => v.estado !== 'cancelada')
      .slice(0, limite)
      .map((v): MovimientoReciente => {
        const cliente = v.venta.clienteNombre ?? 'Mostrador';
        const credito = v.venta.formaPago === 'credito';
        return {
          id: v.venta.id,
          tipo: credito ? 'credito' : 'venta',
          titulo: `Venta ${v.folio} · ${cliente}`,
          detalle: credito && v.venta.venceEl ? `Vence ${v.venta.venceEl.split('-').reverse().join('/')}` : `Contado · ${ETIQUETA_FORMA_PAGO[v.venta.formaPago]}`,
          monto: credito ? D(v.venta.total) : D(v.venta.total),
          fecha: v.venta.creadoEnDispositivo,
          ruta: `/ventas/${v.venta.id}`,
        };
      }),
    ...compras
      .filter((c) => !rechazada(c.operacionId))
      .map((c): MovimientoReciente => ({
        id: c.id,
        tipo: 'compra',
        titulo: `Compra ${folioCompra(c)} · ${c.proveedorNombre}`,
        detalle: c.renglones.map((r) => `${cantidadConUnidad(r.cantidad, { nombre: r.unidadNombre, plural: r.unidadPlural })} ${r.productoNombre.split(' ')[0]}`).join(', '),
        monto: D(c.total).neg(),
        fecha: c.creadoEnDispositivo,
        ruta: '/compras',
      })),
    ...pagos
      .filter((p) => !rechazada(p.operacionId))
      .map((p): MovimientoReciente => ({
        id: p.id,
        tipo: 'pago',
        titulo: `Pago · ${p.clienteNombre}`,
        detalle: ETIQUETA_METODO[p.metodo],
        monto: D(p.monto),
        fecha: p.creadoEnDispositivo,
        ruta: `/clientes/${p.clienteId}`,
      })),
    ...mermas
      .filter((m) => !rechazada(m.operacionId))
      .map((m): MovimientoReciente => {
        const p = productos.find((x) => x.producto.id === m.productoId);
        const c = p?.clasificaciones.find((x) => x.clasificacion.id === m.clasificacionId);
        return {
          id: m.id,
          tipo: 'merma',
          titulo: `Merma · ${p?.producto.nombre.split(' ')[0] ?? 'Producto'} ${c?.clasificacion.nombre.split(' / ')[0] ?? ''}`.trim(),
          detalle: m.motivo ?? 'Merma',
          monto: null,
          textoMonto: p ? `−${cantidadConUnidad(D(m.delta).abs().toString(), p.unidad)}` : m.delta,
          fecha: m.creadoEn,
          ruta: '/inventario/mermas',
        };
      }),
    ...dinero
      .filter((m) => !rechazada(m.operacionId))
      .map((m): MovimientoReciente => ({
        id: m.id,
        tipo: m.tipo,
        titulo: m.concepto,
        detalle: ETIQUETA_METODO[m.metodo],
        monto: m.tipo === 'ingreso' ? D(m.monto) : D(m.monto).neg(),
        fecha: m.creadoEn,
        ruta: '/pagos',
      })),
  ];
  return lista.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, limite);
}

export async function resumenInicio() {
  const [ventas, deudas, bajos, compras, recientes, porRevisar] = await Promise.all([
    ventasVista(),
    deudasVista(),
    inventarioBajo(),
    db.compras.toArray(),
    movimientosRecientes(6),
    db.operaciones.filter((o) => (o.estado === 'en_revision' || o.estado === 'rechazada') && !o.enteradoEn).count(),
  ]);
  const comprasHoy = compras.filter((c) => esHoy(c.creadoEnDispositivo));
  return {
    ventas: resumenVentas(ventas),
    deudas: resumenDeudas(deudas),
    bajos,
    comprasHoy: { total: sumar(comprasHoy.map((c) => c.total)), cantidad: comprasHoy.length },
    comprasRecientes: compras.sort((a, b) => b.creadoEnDispositivo.localeCompare(a.creadoEnDispositivo)).slice(0, 4),
    recientes,
    porRevisar,
  };
}
