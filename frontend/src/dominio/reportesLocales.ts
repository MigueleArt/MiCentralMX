import type {
  GranularidadReporte,
  ProductoVendidoReporte,
  PuntoSerieReporte,
  ResumenReportes,
} from '@micentralmx/shared/api';
import type {
  Clasificacion,
  Compra,
  MovimientoDinero,
  MovimientoInventario,
  Pago,
  Producto,
  Venta,
} from '@micentralmx/shared/entidades';
import { CONFIG } from '../config';
import { db } from '../db/db';
import { aCantidad, aImporte, D, sumar } from '../lib/dinero';
import { diaLocal, diferenciaDias, formatoDia, sumarDias } from '../lib/fechas';
import { cargarOperaciones, existenciasEfectivas, sincronizacionDe } from './consultas';

export type PeriodoReporte = 'diario' | 'semanal' | 'mensual' | 'rango';

export interface RangoPeriodoReporte {
  desde: string;
  hasta: string;
  granularidad: GranularidadReporte;
  titulo: string;
}

export interface DatosFuenteReportes {
  ventas: Venta[];
  compras: Compra[];
  pagos: Pago[];
  movimientosDinero: MovimientoDinero[];
  movimientosInventario: MovimientoInventario[];
  productos: Producto[];
  clasificaciones: Clasificacion[];
  existencias: Array<{ clasificacionId: string; cantidad: string }>;
}

const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const fmtHora24 = new Intl.DateTimeFormat('en-GB', {
  timeZone: CONFIG.zonaHoraria,
  hour: '2-digit',
  hourCycle: 'h23',
});

function horaLocal(iso: string): number {
  const h = Number(fmtHora24.format(new Date(iso)));
  return Number.isFinite(h) ? h % 24 : 0;
}

function etiquetaDiaCorto(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return `${DIAS_CORTO[dow]} ${String(d).padStart(2, '0')}`;
}

export function inferirGranularidadReporte(
  desde: string,
  hasta: string,
  explicita?: GranularidadReporte,
): GranularidadReporte {
  if (explicita) return explicita;
  const dias = diferenciaDias(desde, hasta);
  if (dias <= 0) return 'dia';
  if (dias <= 13) return 'semana';
  return 'mes';
}

export function calcularRangoPeriodo(
  periodo: PeriodoReporte,
  desplazamiento: number,
  desdeCustom: string,
  hastaCustom: string,
  hoy = diaLocal(),
): RangoPeriodoReporte {
  const paso = desplazamiento > 0 ? 0 : desplazamiento;

  if (periodo === 'diario') {
    const d = sumarDias(hoy, paso);
    const prefijo = paso === 0 ? 'Hoy · ' : paso === -1 ? 'Ayer · ' : '';
    return { desde: d, hasta: d, granularidad: 'dia', titulo: `${prefijo}${formatoDia(d)}` };
  }

  if (periodo === 'semanal') {
    const [a, m, d] = hoy.split('-').map(Number);
    const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
    const diffLunes = dow === 0 ? -6 : 1 - dow;
    const lunesActual = sumarDias(hoy, diffLunes);
    const lunes = sumarDias(lunesActual, paso * 7);
    const domingo = sumarDias(lunes, 6);
    const hasta = paso === 0 && hoy < domingo ? hoy : domingo;
    const prefijo = paso === 0 ? 'Esta semana · ' : 'Semana · ';
    return {
      desde: lunes,
      hasta,
      granularidad: 'semana',
      titulo: `${prefijo}${formatoDia(lunes)} al ${formatoDia(hasta)}`,
    };
  }

  if (periodo === 'mensual') {
    const [a, m] = hoy.split('-').map(Number);
    const totalMeses = a * 12 + (m - 1) + paso;
    const targetAnyo = Math.floor(totalMeses / 12);
    const targetMes = (totalMeses % 12) + 1;
    const mesPad = String(targetMes).padStart(2, '0');
    const desde = `${targetAnyo}-${mesPad}-01`;
    const ultimoDia = new Date(Date.UTC(targetAnyo, targetMes, 0)).getUTCDate();
    const finMes = `${targetAnyo}-${mesPad}-${String(ultimoDia).padStart(2, '0')}`;
    const hasta = paso === 0 && hoy < finMes ? hoy : finMes;
    return {
      desde,
      hasta,
      granularidad: 'mes',
      titulo: `${MESES[targetMes - 1]} ${targetAnyo}`,
    };
  }

  const dNorm = desdeCustom <= hastaCustom ? desdeCustom : hastaCustom;
  const hNorm = desdeCustom <= hastaCustom ? hastaCustom : desdeCustom;
  return {
    desde: dNorm,
    hasta: hNorm,
    granularidad: inferirGranularidadReporte(dNorm, hNorm),
    titulo: `Del ${formatoDia(dNorm)} al ${formatoDia(hNorm)}`,
  };
}

function rangoAnterior(desde: string, hasta: string, granularidad: GranularidadReporte): [string, string] {
  if (granularidad === 'mes' && desde.endsWith('-01')) {
    const [a, m] = desde.split('-').map(Number);
    const prevMes = m === 1 ? 12 : m - 1;
    const prevAnyo = m === 1 ? a - 1 : a;
    const prevDesde = `${prevAnyo}-${String(prevMes).padStart(2, '0')}-01`;
    const ultimoDiaPrev = new Date(Date.UTC(prevAnyo, prevMes, 0)).getUTCDate();
    const esMesCompleto = sumarDias(hasta, 1).endsWith('-01');
    const diaTope = esMesCompleto ? ultimoDiaPrev : Math.min(Number(hasta.slice(8, 10)), ultimoDiaPrev);
    const prevHasta = `${prevAnyo}-${String(prevMes).padStart(2, '0')}-${String(diaTope).padStart(2, '0')}`;
    return [prevDesde, prevHasta];
  }
  const dias = diferenciaDias(desde, hasta) + 1;
  const prevHasta = sumarDias(desde, -1);
  const prevDesde = sumarDias(prevHasta, -(dias - 1));
  return [prevDesde, prevHasta];
}

const esVentaContado = (v: Venta) =>
  v.formaPago === 'efectivo' || (v.formaPago === 'transferencia' && v.estado === 'completada');

function resumirColecciones(
  ventas: Venta[],
  pagos: Pago[],
  dinero: MovimientoDinero[],
  desde: string,
  hasta: string,
) {
  const enRango = (iso: string) => {
    const d = diaLocal(iso);
    return d >= desde && d <= hasta;
  };
  const vRango = ventas.filter((v) => enRango(v.creadoEnDispositivo));
  const pRango = pagos.filter((p) => enRango(p.creadoEnDispositivo));
  const dRango = dinero.filter((m) => enRango(m.creadoEn));

  const ventasTotal = sumar(vRango.map((v) => v.total));
  const contadoEfectivo = sumar(vRango.filter((v) => v.formaPago === 'efectivo').map((v) => v.total));
  const contadoTransferencia = sumar(
    vRango.filter((v) => v.formaPago === 'transferencia' && v.estado === 'completada').map((v) => v.total),
  );
  const transferenciaPorConfirmar = sumar(
    vRango.filter((v) => v.formaPago === 'transferencia' && v.estado === 'por_confirmar').map((v) => v.total),
  );
  const creditoTotal = sumar(vRango.filter((v) => v.formaPago === 'credito').map((v) => v.total));
  const ventasContado = contadoEfectivo.plus(contadoTransferencia);
  const abonosDeudas = sumar(pRango.map((p) => p.monto));
  const otrosIngresos = sumar(dRango.filter((m) => m.tipo === 'ingreso').map((m) => m.monto));
  const egresos = sumar(dRango.filter((m) => m.tipo === 'egreso').map((m) => m.monto));
  const totalIngresos = ventasContado.plus(abonosDeudas).plus(otrosIngresos);

  return {
    vRango,
    pRango,
    dRango,
    ventasTotal,
    cantidadVentas: vRango.length,
    cantidadCredito: vRango.filter((v) => v.formaPago === 'credito').length,
    contadoEfectivo,
    contadoTransferencia,
    transferenciaPorConfirmar,
    creditoTotal,
    ventasContado,
    abonosDeudas,
    otrosIngresos,
    egresos,
    totalIngresos,
  };
}

/** Calcula el resumen completo de reportes a partir de colecciones en memoria (paridad con backend). */
export function calcularResumenReportes(
  datos: DatosFuenteReportes,
  desdeRaw: string,
  hastaRaw: string,
  granularidadExplicita?: GranularidadReporte,
  hoy = diaLocal(),
): ResumenReportes {
  const desde = desdeRaw <= hastaRaw ? desdeRaw : hastaRaw;
  const hasta = desdeRaw <= hastaRaw ? hastaRaw : desdeRaw;
  const granularidad = inferirGranularidadReporte(desde, hasta, granularidadExplicita);
  const [prevDesde, prevHasta] = rangoAnterior(desde, hasta, granularidad);

  const ventasActivas = datos.ventas.filter((v) => v.estado !== 'cancelada');
  const actual = resumirColecciones(ventasActivas, datos.pagos, datos.movimientosDinero, desde, hasta);
  const previo = resumirColecciones(ventasActivas, datos.pagos, datos.movimientosDinero, prevDesde, prevHasta);

  const enRango = (iso: string) => {
    const d = diaLocal(iso);
    return d >= desde && d <= hasta;
  };
  const compras = datos.compras.filter((c) => enRango(c.creadoEnDispositivo));
  const movsMerma = datos.movimientosInventario.filter((m) => m.tipo === 'merma' && enRango(m.creadoEn));
  const productosActivos = datos.productos.filter((p) => !p.archivadoEn);
  const abiertas = ventasActivas.filter((v) => v.formaPago === 'credito' && D(v.total).gt(v.pagado));

  let bajos = 0;
  for (const p of productosActivos) {
    for (const c of datos.clasificaciones.filter((x) => x.productoId === p.id && !x.archivadoEn)) {
      const e = D(datos.existencias.find((x) => x.clasificacionId === c.id)?.cantidad ?? 0);
      if (e.gt(0) && e.lte(p.umbralBajo)) bajos++;
    }
  }

  const ticketPromedio = actual.cantidadVentas > 0 ? actual.ventasTotal.div(actual.cantidadVentas) : D(0);

  // Serie temporal
  let serie: PuntoSerieReporte[] = [];
  if (granularidad === 'dia' && desde === hasta) {
    const franjas = [
      { clave: '00-07', etiqueta: 'Madrugada', min: 0, max: 7 },
      { clave: '07-12', etiqueta: 'Mañana', min: 7, max: 12 },
      { clave: '12-17', etiqueta: 'Tarde', min: 12, max: 17 },
      { clave: '17-24', etiqueta: 'Noche', min: 17, max: 24 },
    ];
    serie = franjas.map((fr) => {
      const vf = actual.vRango.filter((v) => {
        const h = horaLocal(v.creadoEnDispositivo);
        return h >= fr.min && h < fr.max;
      });
      const pf = actual.pRango.filter((p) => {
        const h = horaLocal(p.creadoEnDispositivo);
        return h >= fr.min && h < fr.max;
      });
      const df = actual.dRango.filter((m) => {
        const h = horaLocal(m.creadoEn);
        return h >= fr.min && h < fr.max;
      });
      const vTot = sumar(vf.map((v) => v.total));
      const vCont = sumar(vf.filter(esVentaContado).map((v) => v.total));
      const vCred = sumar(vf.filter((v) => v.formaPago === 'credito').map((v) => v.total));
      const ab = sumar(pf.map((p) => p.monto));
      const ot = sumar(df.filter((m) => m.tipo === 'ingreso').map((m) => m.monto));
      const eg = sumar(df.filter((m) => m.tipo === 'egreso').map((m) => m.monto));
      return {
        clave: fr.clave,
        etiqueta: fr.etiqueta,
        desde,
        hasta,
        ventasTotal: aImporte(vTot),
        ventasContado: aImporte(vCont),
        ventasCredito: aImporte(vCred),
        ingresosTotal: aImporte(vCont.plus(ab).plus(ot)),
        abonos: aImporte(ab),
        egresos: aImporte(eg),
        cantidadVentas: vf.length,
      };
    });
  } else {
    const totalDias = diferenciaDias(desde, hasta) + 1;
    const porSemanas = (granularidad === 'mes' && totalDias > 14) || totalDias > 62;
    const cubetas: Array<{ clave: string; etiqueta: string; d: string; h: string }> = [];

    if (porSemanas) {
      let cur = desde;
      let sem = 1;
      while (cur <= hasta) {
        const finPropuesto = sumarDias(cur, 6);
        const fin = finPropuesto <= hasta ? finPropuesto : hasta;
        const mismoMes = cur.slice(0, 7) === fin.slice(0, 7);
        const etiqueta = mismoMes
          ? `Sem ${sem} (${cur.slice(8, 10)}–${fin.slice(8, 10)})`
          : `Sem ${sem} (${cur.slice(8, 10)}/${cur.slice(5, 7)})`;
        cubetas.push({ clave: cur, etiqueta, d: cur, h: fin });
        cur = sumarDias(fin, 1);
        sem++;
      }
    } else {
      let cur = desde;
      while (cur <= hasta) {
        cubetas.push({ clave: cur, etiqueta: etiquetaDiaCorto(cur), d: cur, h: cur });
        cur = sumarDias(cur, 1);
      }
    }

    serie = cubetas.map((cb) => {
      const vf = actual.vRango.filter((v) => {
        const dia = diaLocal(v.creadoEnDispositivo);
        return dia >= cb.d && dia <= cb.h;
      });
      const pf = actual.pRango.filter((p) => {
        const dia = diaLocal(p.creadoEnDispositivo);
        return dia >= cb.d && dia <= cb.h;
      });
      const df = actual.dRango.filter((m) => {
        const dia = diaLocal(m.creadoEn);
        return dia >= cb.d && dia <= cb.h;
      });
      const vTot = sumar(vf.map((v) => v.total));
      const vCont = sumar(vf.filter(esVentaContado).map((v) => v.total));
      const vCred = sumar(vf.filter((v) => v.formaPago === 'credito').map((v) => v.total));
      const ab = sumar(pf.map((p) => p.monto));
      const ot = sumar(df.filter((m) => m.tipo === 'ingreso').map((m) => m.monto));
      const eg = sumar(df.filter((m) => m.tipo === 'egreso').map((m) => m.monto));
      return {
        clave: cb.clave,
        etiqueta: cb.etiqueta,
        desde: cb.d,
        hasta: cb.h,
        ventasTotal: aImporte(vTot),
        ventasContado: aImporte(vCont),
        ventasCredito: aImporte(vCred),
        ingresosTotal: aImporte(vCont.plus(ab).plus(ot)),
        abonos: aImporte(ab),
        egresos: aImporte(eg),
        cantidadVentas: vf.length,
      };
    });
  }

  // Top 5 productos vendidos
  const mapaTop = new Map<
    string,
    {
      productoId: string;
      nombre: string;
      clasificacion: string;
      unidad: string;
      cantidad: ReturnType<typeof D>;
      importe: ReturnType<typeof D>;
    }
  >();
  for (const v of actual.vRango) {
    for (const r of v.renglones) {
      const prev = mapaTop.get(r.clasificacionId) ?? {
        productoId: r.productoId,
        nombre: r.productoNombre,
        clasificacion: r.clasificacionNombre,
        unidad: r.unidadPlural,
        cantidad: D(0),
        importe: D(0),
      };
      prev.cantidad = prev.cantidad.plus(r.cantidad);
      prev.importe = prev.importe.plus(r.importe);
      mapaTop.set(r.clasificacionId, prev);
    }
  }
  const topProductos: ProductoVendidoReporte[] = Array.from(mapaTop.values())
    .sort((a, b) => b.importe.comparedTo(a.importe))
    .slice(0, 5)
    .map((x) => ({
      productoId: x.productoId,
      nombre: x.nombre,
      clasificacion: x.clasificacion,
      unidad: x.unidad,
      cantidad: aCantidad(x.cantidad),
      importe: aImporte(x.importe),
    }));

  return {
    desde,
    hasta,
    granularidad,
    ventas: {
      total: aImporte(actual.ventasTotal),
      cantidad: actual.cantidadVentas,
      aCredito: actual.cantidadCredito,
    },
    ventasDetalle: {
      contadoEfectivo: aImporte(actual.contadoEfectivo),
      contadoTransferencia: aImporte(actual.contadoTransferencia),
      transferenciaPorConfirmar: aImporte(actual.transferenciaPorConfirmar),
      credito: aImporte(actual.creditoTotal),
      ticketPromedio: aImporte(ticketPromedio),
    },
    ingresosDetalle: {
      ventasContado: aImporte(actual.ventasContado),
      abonosDeudas: aImporte(actual.abonosDeudas),
      otrosIngresos: aImporte(actual.otrosIngresos),
      totalIngresos: aImporte(actual.totalIngresos),
      egresos: aImporte(actual.egresos),
      balanceNeto: aImporte(actual.totalIngresos.minus(actual.egresos)),
    },
    comparativa: {
      desde: prevDesde,
      hasta: prevHasta,
      ventasTotal: aImporte(previo.ventasTotal),
      ingresosTotal: aImporte(previo.totalIngresos),
      cantidadVentas: previo.cantidadVentas,
    },
    serie,
    topProductos,
    compras: {
      total: aImporte(sumar(compras.map((c) => c.total))),
      cantidad: compras.length,
      proveedores: new Set(compras.map((c) => c.proveedorId)).size,
    },
    inventario: { productos: productosActivos.length, bajos },
    pagos: {
      ingresos: aImporte(sumar([actual.abonosDeudas, actual.otrosIngresos])),
      egresos: aImporte(actual.egresos),
    },
    deudas: {
      porCobrar: aImporte(sumar(abiertas.map((v) => D(v.total).minus(v.pagado)))),
      vencido: aImporte(
        sumar(abiertas.filter((v) => v.venceEl && diferenciaDias(hoy, v.venceEl) < 0).map((v) => D(v.total).minus(v.pagado))),
      ),
    },
    mermas: {
      valor: aImporte(
        sumar(
          movsMerma.map((m) =>
            D(m.delta)
              .abs()
              .times(datos.clasificaciones.find((c) => c.id === m.clasificacionId)?.ultimoCosto ?? 0),
          ),
        ),
      ),
      cantidad: sumar(movsMerma.map((m) => D(m.delta).abs())).toString(),
      unidad: 'unidades',
    },
  };
}

/** Respaldo local en Dexie para consultar reportes sin conexión. */
export async function resumenReportesLocal(
  desde: string,
  hasta: string,
  granularidad?: GranularidadReporte,
): Promise<ResumenReportes> {
  const [
    { porId },
    ventas,
    compras,
    pagos,
    movimientosDinero,
    movimientosInventario,
    productos,
    clasificaciones,
    existenciasMap,
  ] = await Promise.all([
    cargarOperaciones(),
    db.ventas.toArray(),
    db.compras.toArray(),
    db.pagos.toArray(),
    db.movimientosDinero.toArray(),
    db.movimientosInventario.toArray(),
    db.productos.toArray(),
    db.clasificaciones.toArray(),
    existenciasEfectivas(),
  ]);

  const valida = (opId?: string | null) => sincronizacionDe(porId, opId) !== 'rechazada';
  const existencias = Array.from(existenciasMap.entries()).map(([clasificacionId, cant]) => ({
    clasificacionId,
    cantidad: cant.toString(),
  }));

  return calcularResumenReportes(
    {
      ventas: ventas.filter((v) => valida(v.operacionId)),
      compras: compras.filter((c) => valida(c.operacionId)),
      pagos: pagos.filter((p) => valida(p.operacionId)),
      movimientosDinero: movimientosDinero.filter((m) => valida(m.operacionId)),
      movimientosInventario: movimientosInventario.filter((m) => valida(m.operacionId)),
      productos,
      clasificaciones,
      existencias,
    },
    desde,
    hasta,
    granularidad,
  );
}

/** Evita que Excel convierta "Mar 17" en una fecha usando el nombre completo del día + fecha DD/MM/AAAA. */
export function etiquetaSerieExport(r: ResumenReportes, s: PuntoSerieReporte): string {
  if (s.desde === s.hasta && r.granularidad !== 'dia') {
    const [a, m, d] = s.desde.split('-').map(Number);
    const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
    return `${DIAS_LARGO[dow]} ${formatoDia(s.desde)}`;
  }
  return s.etiqueta;
}

function celdaCsv(v: string | number): string {
  const texto = String(v);
  if (/[",\r\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

/** Genera contenido CSV legible en Excel para compartir o archivar reportes. */
export function exportarReporteCsv(r: ResumenReportes, negocio = 'MiCentralMX'): string {
  const filas: string[] = [];
  const fila = (...cols: Array<string | number>) => filas.push(cols.map(celdaCsv).join(','));
  const nombreGranularidad = { dia: 'Diario', semana: 'Semanal', mes: 'Mensual' }[r.granularidad];

  fila(`Reporte ${negocio}`, `${formatoDia(r.desde)} al ${formatoDia(r.hasta)}`, `Vista: ${nombreGranularidad}`);
  fila('');
  fila('Concepto', 'Valor');
  fila('Ventas totales', r.ventas.total);
  fila('Cantidad de ventas', r.ventas.cantidad);
  fila('Ticket promedio', r.ventasDetalle.ticketPromedio);
  fila('Contado efectivo', r.ventasDetalle.contadoEfectivo);
  fila('Contado transferencia confirmada', r.ventasDetalle.contadoTransferencia);
  fila('Transferencia por confirmar', r.ventasDetalle.transferenciaPorConfirmar);
  fila('Ventas a crédito', r.ventasDetalle.credito);
  fila('Ingresos reales totales', r.ingresosDetalle.totalIngresos);
  fila('Abonos a deudas', r.ingresosDetalle.abonosDeudas);
  fila('Otros ingresos', r.ingresosDetalle.otrosIngresos);
  fila('Egresos', r.ingresosDetalle.egresos);
  fila('Balance neto', r.ingresosDetalle.balanceNeto);
  fila('Compras totales', r.compras.total);
  fila('Por cobrar total', r.deudas.porCobrar);
  fila('Saldo vencido', r.deudas.vencido);
  fila('Mermas (valor aproximado)', r.mermas.valor);
  fila('');
  fila('Desglose del periodo', 'Desde', 'Hasta', 'Ventas (#)', 'Ventas ($)', 'Contado ($)', 'Crédito ($)', 'Abonos ($)', 'Ingresos ($)', 'Egresos ($)');
  for (const s of r.serie) {
    fila(
      etiquetaSerieExport(r, s),
      formatoDia(s.desde),
      formatoDia(s.hasta),
      s.cantidadVentas,
      s.ventasTotal,
      s.ventasContado,
      s.ventasCredito,
      s.abonos,
      s.ingresosTotal,
      s.egresos,
    );
  }
  if (r.topProductos.length > 0) {
    fila('');
    fila('Productos más vendidos', 'Clasificación', 'Cantidad', 'Unidad', 'Importe ($)');
    for (const p of r.topProductos) {
      fila(p.nombre, p.clasificacion, p.cantidad, p.unidad, p.importe);
    }
  }
  return filas.join('\r\n');
}

export function descargarReporteCsv(r: ResumenReportes, negocio = 'MiCentralMX'): void {
  const csv = exportarReporteCsv(r, negocio);
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reporte-${r.desde}-${r.hasta}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
