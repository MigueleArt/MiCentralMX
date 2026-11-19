import type Decimal from 'decimal.js';
import type { CategoriaDinero, MetodoPago } from '@micentralmx/shared/entidades';
import type { EstadoSync } from '../../db/db';
import { coincideTokens } from '../../dominio/buscarProductos';
import { CATEGORIAS_DINERO, ETIQUETA_METODO } from '../../dominio/formato';
import { D, formatoMXN, formatoMXNSigno } from '../../lib/dinero';
import { diaLocal, diferenciaDias, formatoDia, formatoFechaHora, sumarDias } from '../../lib/fechas';

export type TipoMovimientoFiltro = 'todos' | 'ingreso' | 'egreso';
export type CategoriaMovimientoPago = 'cobro_cliente' | CategoriaDinero;
export type PeriodoPagos = 'todos' | 'hoy' | 'ayer' | 'semana' | 'mes' | 'rango';
export type OrdenPagos = 'recientes' | 'antiguos' | 'monto_desc' | 'monto_asc';
export type ChipPago = 'todos' | 'ingreso' | 'egreso' | 'cobro_cliente' | 'pago_proveedor' | 'sin_sync' | 'otro';

export interface AplicacionDeudaResumen {
  ventaId: string;
  folio: string;
  monto: string;
}

export interface MovimientoPagoVista {
  id: string;
  origen: 'pago' | 'dinero';
  tipo: 'ingreso' | 'egreso';
  icono: 'cobro' | 'ingreso' | 'egreso';
  categoria: CategoriaMovimientoPago;
  categoriaNombre: string;
  titulo: string;
  subtitulo: string;
  monto: string;
  metodo: MetodoPago;
  fecha: string;
  dia: string;
  usuarioNombre: string;
  nota: string | null;
  excedente: string | null;
  requiereRevision: boolean;
  clienteId: string | null;
  clienteNombre: string | null;
  proveedorId: string | null;
  proveedorNombre: string | null;
  aplicaciones: AplicacionDeudaResumen[];
  sync: EstadoSync | null;
}

export interface FiltrosPagos {
  tipo: TipoMovimientoFiltro;
  periodo: PeriodoPagos;
  desde: string;
  hasta: string;
  metodo: MetodoPago | null;
  categoria: CategoriaMovimientoPago | null;
  sinSincronizar: boolean;
  orden: OrdenPagos;
}

export interface ResumenPagos {
  ingresos: Decimal;
  cantidadIngresos: number;
  egresos: Decimal;
  cantidadEgresos: number;
  balance: Decimal;
  efectivoIngresos: Decimal;
  efectivoEgresos: Decimal;
  efectivoNeto: Decimal;
  transferenciaIngresos: Decimal;
  transferenciaEgresos: Decimal;
  transferenciaNeto: Decimal;
  otroNeto: Decimal;
  totalMovimientos: number;
}

export interface GrupoDiaPagos {
  dia: string;
  etiqueta: string;
  ingresos: Decimal;
  egresos: Decimal;
  balance: Decimal;
  movimientos: MovimientoPagoVista[];
}

export const ETIQUETAS_CATEGORIA_PAGO: Record<CategoriaMovimientoPago, string> = {
  cobro_cliente: 'Cobro a cliente',
  pago_proveedor: CATEGORIAS_DINERO.pago_proveedor.nombre,
  anticipo_productor: CATEGORIAS_DINERO.anticipo_productor.nombre,
  flete: CATEGORIAS_DINERO.flete.nombre,
  sueldo: CATEGORIAS_DINERO.sueldo.nombre,
  otro_egreso: CATEGORIAS_DINERO.otro_egreso.nombre,
  renta: CATEGORIAS_DINERO.renta.nombre,
  otro_ingreso: CATEGORIAS_DINERO.otro_ingreso.nombre,
};

export const ETIQUETAS_ORDEN_PAGOS: Record<OrdenPagos, string> = {
  recientes: 'Más recientes',
  antiguos: 'Más antiguos',
  monto_desc: 'Mayor monto',
  monto_asc: 'Menor monto',
};

export function crearFiltrosPagosIniciales(hoy = diaLocal()): FiltrosPagos {
  return {
    tipo: 'todos',
    periodo: 'todos',
    desde: hoy,
    hasta: hoy,
    metodo: null,
    categoria: null,
    sinSincronizar: false,
    orden: 'recientes',
  };
}

export function rangoPeriodoPagos(f: Pick<FiltrosPagos, 'periodo' | 'desde' | 'hasta'>, hoy = diaLocal()): [string, string] | null {
  switch (f.periodo) {
    case 'todos':
      return null;
    case 'hoy':
      return [hoy, hoy];
    case 'ayer': {
      const ayer = sumarDias(hoy, -1);
      return [ayer, ayer];
    }
    case 'semana':
      return [sumarDias(hoy, -6), hoy];
    case 'mes':
      return [`${hoy.slice(0, 7)}-01`, hoy];
    case 'rango':
      return f.desde <= f.hasta ? [f.desde, f.hasta] : [f.hasta, f.desde];
  }
}

export function etiquetaPeriodoPagos(f: Pick<FiltrosPagos, 'periodo' | 'desde' | 'hasta'>): string {
  switch (f.periodo) {
    case 'todos':
      return 'Todo el historial';
    case 'hoy':
      return 'Hoy';
    case 'ayer':
      return 'Ayer';
    case 'semana':
      return 'Últimos 7 días';
    case 'mes':
      return 'Este mes';
    case 'rango': {
      const [desde, hasta] = f.desde <= f.hasta ? [f.desde, f.hasta] : [f.hasta, f.desde];
      return `${formatoDia(desde)} al ${formatoDia(hasta)}`;
    }
  }
}

/** Filtra y ordena los movimientos de caja según tipo, periodo, método, categoría, sync y texto libre. */
export function filtrarMovimientosPago(
  lista: MovimientoPagoVista[],
  f: FiltrosPagos,
  busqueda: string,
  hoy = diaLocal(),
): MovimientoPagoVista[] {
  const rango = rangoPeriodoPagos(f, hoy);
  const consulta = busqueda.trim();

  const filtrados = lista.filter((m) => {
    if (f.tipo !== 'todos' && m.tipo !== f.tipo) return false;
    if (rango && (m.dia < rango[0] || m.dia > rango[1])) return false;
    if (f.metodo && m.metodo !== f.metodo) return false;
    if (f.categoria && m.categoria !== f.categoria) return false;
    if (f.sinSincronizar && !(m.sync === 'pendiente' || m.sync === 'enviando')) return false;

    if (consulta) {
      const texto = [
        m.titulo,
        m.subtitulo,
        m.categoriaNombre,
        ETIQUETA_METODO[m.metodo],
        m.clienteNombre ?? '',
        m.proveedorNombre ?? '',
        m.usuarioNombre,
        m.nota ?? '',
        m.aplicaciones.map((a) => a.folio).join(' '),
        formatoDia(m.dia),
      ].join(' ');
      if (!coincideTokens(texto, consulta)) return false;
    }

    return true;
  });

  return [...filtrados].sort((a, b) => {
    switch (f.orden) {
      case 'recientes':
        return b.fecha.localeCompare(a.fecha);
      case 'antiguos':
        return a.fecha.localeCompare(b.fecha);
      case 'monto_desc':
        return D(b.monto).cmp(D(a.monto)) || b.fecha.localeCompare(a.fecha);
      case 'monto_asc':
        return D(a.monto).cmp(D(b.monto)) || b.fecha.localeCompare(a.fecha);
    }
  });
}

export function contarFiltrosPagosActivos(f: FiltrosPagos): number {
  return [
    f.tipo !== 'todos',
    f.periodo !== 'todos',
    f.metodo !== null,
    f.categoria !== null,
    f.sinSincronizar,
    f.orden !== 'recientes',
  ].filter(Boolean).length;
}

export function chipPagoActivo(f: FiltrosPagos): ChipPago {
  if (f.sinSincronizar) {
    return f.tipo === 'todos' && !f.categoria ? 'sin_sync' : 'otro';
  }
  if (f.categoria === 'cobro_cliente' && (f.tipo === 'todos' || f.tipo === 'ingreso')) {
    return 'cobro_cliente';
  }
  if (f.categoria === 'pago_proveedor' && (f.tipo === 'todos' || f.tipo === 'egreso')) {
    return 'pago_proveedor';
  }
  if (f.categoria) return 'otro';
  if (f.tipo === 'ingreso') return 'ingreso';
  if (f.tipo === 'egreso') return 'egreso';
  return 'todos';
}

export function filtrosDesdeChipPago(chip: ChipPago, actual: FiltrosPagos): FiltrosPagos {
  if (chip === 'otro') return actual;
  const base = { ...actual };
  switch (chip) {
    case 'todos':
      return { ...base, tipo: 'todos', categoria: null, sinSincronizar: false };
    case 'ingreso':
      return { ...base, tipo: 'ingreso', categoria: null, sinSincronizar: false };
    case 'egreso':
      return { ...base, tipo: 'egreso', categoria: null, sinSincronizar: false };
    case 'cobro_cliente':
      return { ...base, tipo: 'todos', categoria: 'cobro_cliente', sinSincronizar: false };
    case 'pago_proveedor':
      return { ...base, tipo: 'todos', categoria: 'pago_proveedor', sinSincronizar: false };
    case 'sin_sync':
      return { ...base, tipo: 'todos', categoria: null, sinSincronizar: true };
  }
}

export function resumenMovimientosPago(lista: MovimientoPagoVista[]): ResumenPagos {
  let ingresos = D(0);
  let cantidadIngresos = 0;
  let egresos = D(0);
  let cantidadEgresos = 0;
  let efectivoIngresos = D(0);
  let efectivoEgresos = D(0);
  let transferenciaIngresos = D(0);
  let transferenciaEgresos = D(0);
  let otroNeto = D(0);

  for (const m of lista) {
    const monto = D(m.monto);
    if (m.tipo === 'ingreso') {
      ingresos = ingresos.plus(monto);
      cantidadIngresos += 1;
      if (m.metodo === 'efectivo') efectivoIngresos = efectivoIngresos.plus(monto);
      else if (m.metodo === 'transferencia') transferenciaIngresos = transferenciaIngresos.plus(monto);
      else otroNeto = otroNeto.plus(monto);
    } else {
      egresos = egresos.plus(monto);
      cantidadEgresos += 1;
      if (m.metodo === 'efectivo') efectivoEgresos = efectivoEgresos.plus(monto);
      else if (m.metodo === 'transferencia') transferenciaEgresos = transferenciaEgresos.plus(monto);
      else otroNeto = otroNeto.minus(monto);
    }
  }

  return {
    ingresos,
    cantidadIngresos,
    egresos,
    cantidadEgresos,
    balance: ingresos.minus(egresos),
    efectivoIngresos,
    efectivoEgresos,
    efectivoNeto: efectivoIngresos.minus(efectivoEgresos),
    transferenciaIngresos,
    transferenciaEgresos,
    transferenciaNeto: transferenciaIngresos.minus(transferenciaEgresos),
    otroNeto,
    totalMovimientos: lista.length,
  };
}

export function agruparMovimientosPorDia(lista: MovimientoPagoVista[], hoy = diaLocal()): GrupoDiaPagos[] {
  const grupos = new Map<string, MovimientoPagoVista[]>();
  for (const m of lista) {
    const arr = grupos.get(m.dia);
    if (arr) arr.push(m);
    else grupos.set(m.dia, [m]);
  }

  return Array.from(grupos.entries()).map(([dia, movimientos]) => {
    let ingresos = D(0);
    let egresos = D(0);
    for (const m of movimientos) {
      if (m.tipo === 'ingreso') ingresos = ingresos.plus(m.monto);
      else egresos = egresos.plus(m.monto);
    }
    const etiqueta = dia === hoy ? 'Hoy' : diferenciaDias(dia, hoy) === 1 ? 'Ayer' : formatoDia(dia);
    return {
      dia,
      etiqueta,
      ingresos,
      egresos,
      balance: ingresos.minus(egresos),
      movimientos,
    };
  });
}

export function textoComprobanteMovimiento(m: MovimientoPagoVista, negocio: string): string {
  const montoConSigno = formatoMXNSigno(m.tipo === 'ingreso' ? D(m.monto) : D(m.monto).neg());
  const lineas = [
    `*Comprobante de ${m.tipo === 'ingreso' ? 'ingreso' : 'egreso'} · ${negocio}*`,
    `Concepto: ${m.titulo}`,
    `Categoría: ${m.categoriaNombre}`,
    `Monto: ${montoConSigno}`,
    `Método: ${ETIQUETA_METODO[m.metodo]}`,
    `Fecha: ${formatoFechaHora(m.fecha)}`,
  ];
  if (m.aplicaciones.length > 0) {
    lineas.push(`Deudas aplicadas: ${m.aplicaciones.map((a) => `${a.folio} (${formatoMXN(a.monto)})`).join(', ')}`);
  }
  if (m.excedente && D(m.excedente).gt(0)) {
    lineas.push(`Saldo a favor: ${formatoMXN(m.excedente)}`);
  }
  if (m.nota?.trim()) {
    lineas.push(`Nota: ${m.nota.trim()}`);
  }
  lineas.push(`Registrado por: ${m.usuarioNombre}`);
  return lineas.join('\n');
}
