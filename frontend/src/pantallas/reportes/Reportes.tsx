import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  HandCoins,
  Package,
  PackageMinus,
  Printer,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Truck,
  Wallet,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { AvisoLinea, ErrorConsulta, Esqueleto } from '../../componentes/Estados';
import { Campo, Chips } from '../../componentes/Formulario';
import type { PuntoSerieReporte, ReporteProductores, ResumenReportes } from '@micentralmx/shared/api';
import { descargarReporteExcel } from '../../dominio/exportarExcel';
import {
  calcularRangoPeriodo,
  resumenReportesLocal,
  type PeriodoReporte,
} from '../../dominio/reportesLocales';
import { useFormato } from '../../hooks/useFormato';
import { EncabezadoPagina, EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoCantidad, formatoMXN, formatoMXNSigno, sumar } from '../../lib/dinero';
import { diaLocal, formatoDia, formatoFechaHora, sumarDias } from '../../lib/fechas';
import { useConectividad } from '../../sync/conectividad';
import './reportes.css';

function Tarjeta({ icono: Icono, titulo, detalle, valor }: { icono: LucideIcon; titulo: string; detalle: string; valor: string }) {
  return (
    <div className="rowlink" style={{ cursor: 'default' }}>
      <span className="ib">
        <Icono className="ic" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600 }}>{titulo}</p>
        <p className="t-aux num">{detalle}</p>
      </div>
      <p className="num" style={{ fontWeight: 700, fontSize: 17 }}>
        {valor}
      </p>
    </div>
  );
}

function DeltaComparativa({ actual, previo }: { actual: string; previo: string }) {
  const act = D(actual);
  const ant = D(previo);
  if (ant.lte(0)) return null;
  const pct = act.minus(ant).div(ant).times(100).toDecimalPlaces(0).toNumber();
  const clase = pct > 0 ? 'sube' : pct < 0 ? 'baja' : 'igual';
  const texto = pct > 0 ? `+${pct}% vs ant.` : pct < 0 ? `${pct}% vs ant.` : 'Igual vs ant.';
  return <span className={`reportes-delta num ${clase}`}>{texto}</span>;
}

function formatoEjeCorto(valor: number): string {
  if (valor >= 1_000_000) return `$${(valor / 1_000_000).toFixed(1)}M`;
  if (valor >= 1_000) return `$${(valor / 1_000).toFixed(valor >= 10_000 ? 0 : 1)}k`;
  return `$${Math.round(valor)}`;
}

function GraficaVentasIngresos({ serie, granularidad }: { serie: PuntoSerieReporte[]; granularidad: ResumenReportes['granularidad'] }) {
  const maxValor = Math.max(
    100,
    ...serie.flatMap((p) => [Number(p.ventasTotal), Number(p.ingresosTotal)]),
  );
  const hayDatos = serie.some((p) => Number(p.ventasTotal) > 0 || Number(p.ingresosTotal) > 0);

  const ancho = Math.max(480, serie.length * 64 + 72);
  const alto = 220;
  const padIzq = 54;
  const padDer = 16;
  const padTop = 18;
  const padAbajo = 34;
  const areaAncho = ancho - padIzq - padDer;
  const areaAlto = alto - padTop - padAbajo;
  const pasoGrupo = serie.length > 0 ? areaAncho / serie.length : areaAncho;
  const anchoBarra = Math.max(10, Math.min(24, pasoGrupo * 0.3));

  const subtitulo =
    granularidad === 'dia'
      ? 'Distribución del día por horario'
      : granularidad === 'semana'
        ? 'Comportamiento diario de ventas e ingresos'
        : 'Resumen semanal del periodo';

  return (
    <section className="card reportes-grafica-card" aria-label="Gráfica de ventas e ingresos">
      <div className="reportes-grafica-cabecera">
        <div>
          <h2 className="t-sec">Ventas vs. ingresos reales</h2>
          <p className="t-aux">{subtitulo}</p>
        </div>
        <div className="reportes-leyenda">
          <span className="reportes-leyenda-item">
            <svg width="10" height="10" aria-hidden="true">
              <rect width="10" height="10" rx="2" fill="#146c58" />
            </svg>
            Ventas
          </span>
          <span className="reportes-leyenda-item">
            <svg width="10" height="10" aria-hidden="true">
              <rect width="10" height="10" rx="2" fill="#255a80" />
            </svg>
            Ingresos reales
          </span>
        </div>
      </div>

      {!hayDatos ? (
        <p className="t-2" style={{ padding: '18px 0', textAlign: 'center' }}>
          No hay ventas ni ingresos registrados en este periodo para graficar.
        </p>
      ) : (
        <div className="reportes-grafica-scroll">
          <svg
            className="reportes-grafica-svg"
            viewBox={`0 0 ${ancho} ${alto}`}
            role="img"
            aria-label="Barras comparativas de ventas e ingresos"
          >
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const y = padTop + areaAlto * (1 - frac);
              const val = maxValor * frac;
              return (
                <g key={frac}>
                  <line x1={padIzq} x2={ancho - padDer} y1={y} y2={y} stroke="var(--gris-3)" strokeWidth="1" />
                  <text x={padIzq - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--texto-2)">
                    {formatoEjeCorto(val)}
                  </text>
                </g>
              );
            })}

            {serie.map((pt, i) => {
              const centroX = padIzq + pasoGrupo * i + pasoGrupo / 2;
              const vVal = Number(pt.ventasTotal);
              const iVal = Number(pt.ingresosTotal);
              const vH = (vVal / maxValor) * areaAlto;
              const iH = (iVal / maxValor) * areaAlto;
              const vY = padTop + areaAlto - vH;
              const iY = padTop + areaAlto - iH;
              const gap = 4;

              return (
                <g key={pt.clave}>
                  <rect
                    x={centroX - anchoBarra - gap / 2}
                    y={vY}
                    width={anchoBarra}
                    height={Math.max(vVal > 0 ? 2 : 0, vH)}
                    rx="4"
                    fill="var(--color-primario)"
                  >
                    <title>{`${pt.etiqueta} · Ventas: ${formatoMXN(pt.ventasTotal)}`}</title>
                  </rect>
                  <rect
                    x={centroX + gap / 2}
                    y={iY}
                    width={anchoBarra}
                    height={Math.max(iVal > 0 ? 2 : 0, iH)}
                    rx="4"
                    fill="#255a80"
                  >
                    <title>{`${pt.etiqueta} · Ingresos: ${formatoMXN(pt.ingresosTotal)}`}</title>
                  </rect>
                  <text x={centroX} y={alto - 10} textAnchor="middle" fontSize="11" fill="var(--texto-2)">
                    {pt.etiqueta}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {serie.length > 0 && (
        <div className="tabla-scroll">
          <table className="tbl tbl-c">
            <thead>
              <tr>
                <th>Periodo</th>
                <th className="r">Ventas (#)</th>
                <th className="r">Ventas ($)</th>
                <th className="r">Contado</th>
                <th className="r">Crédito</th>
                <th className="r">Abonos</th>
                <th className="r">Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {serie.map((pt) => (
                <tr key={pt.clave}>
                  <td style={{ fontWeight: 600 }}>{pt.etiqueta}</td>
                  <td className="r num">{pt.cantidadVentas}</td>
                  <td className="r num" style={{ fontWeight: 600 }}>{formatoMXN(pt.ventasTotal)}</td>
                  <td className="r num">{formatoMXN(pt.ventasContado)}</td>
                  <td className="r num">{formatoMXN(pt.ventasCredito)}</td>
                  <td className="r num">{formatoMXN(pt.abonos)}</td>
                  <td className="r num" style={{ fontWeight: 700, color: 'var(--color-primario-osc)' }}>
                    {formatoMXN(pt.ingresosTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Pantalla 26 · Reportes diario, semanal y mensual con respaldo sin conexión. */
export default function Reportes() {
  const { sesion } = useSesionActiva();
  const formato = useFormato();
  const { enLinea } = useConectividad();
  const [periodo, setPeriodo] = useState<PeriodoReporte>('semanal');
  const [desplazamiento, setDesplazamiento] = useState(0);
  const [desde, setDesde] = useState(sumarDias(diaLocal(), -6));
  const [hasta, setHasta] = useState(diaLocal());

  const rangoActual = calcularRangoPeriodo(periodo, desplazamiento, desde, hasta);
  const d = rangoActual.desde;
  const h = rangoActual.hasta;
  const granularidad = rangoActual.granularidad;

  const q = useQuery({
    queryKey: ['reportes', d, h, granularidad],
    queryFn: () => api<ResumenReportes>('GET', `/reportes/resumen?desde=${d}&hasta=${h}&granularidad=${granularidad}`),
    enabled: enLinea,
  });

  const local = useLiveQuery(() => resumenReportesLocal(d, h, granularidad), [d, h, granularidad]);

  const qProd = useQuery({
    queryKey: ['reportes-productores', d, h],
    queryFn: () => api<ReporteProductores>('GET', `/reportes/productores?desde=${d}&hasta=${h}`),
    enabled: enLinea,
  });

  const usandoRespaldoLocal = !enLinea || q.isError;
  const r = enLinea && q.data ? q.data : usandoRespaldoLocal ? local : q.data;
  const rp = qProd.data;
  const totalComisionGanada = rp ? sumar(rp.productores.map((p) => p.comisionGanada)) : D(0);

  const cambiarPeriodo = (nuevo: PeriodoReporte) => {
    setPeriodo(nuevo);
    setDesplazamiento(0);
  };

  return (
    <>
      <div className="no-print">
        {formato === 'telefono' ? <EncabezadoSecundario titulo="Reportes" volverA="/mas" /> : <EncabezadoPagina titulo="Reportes" />}
      </div>
      <main className={`pag-main${formato === 'telefono' ? ' con-enc-sec' : ''}`}>
        <div className="pila-16 reportes-pagina">
          <header className="reportes-print-header">
            <div>
              <p className="lbl" style={{ color: 'var(--color-primario-osc)' }}>
                MiCentralMX · {sesion.negocio.nombre}
              </p>
              <h2 className="t-title">Reporte de ventas e ingresos</h2>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontWeight: 600 }}>{rangoActual.titulo}</p>
              <p className="t-aux num">
                {d === h ? formatoDia(d) : `Del ${formatoDia(d)} al ${formatoDia(h)}`} · Generado: {formatoFechaHora(new Date())}
              </p>
            </div>
          </header>

          <div className="reportes-controles no-print">
            <Chips<PeriodoReporte>
              etiqueta="Periodo"
              valor={periodo}
              alCambiar={cambiarPeriodo}
              opciones={[
                { valor: 'diario', texto: 'Diario' },
                { valor: 'semanal', texto: 'Semanal' },
                { valor: 'mensual', texto: 'Mensual' },
                { valor: 'rango', texto: 'Elegir fechas' },
              ]}
            />
            {r && (
              <div className="reportes-acciones">
                <button type="button" className="btn btn-s btn-sm" onClick={() => descargarReporteExcel(r, sesion.negocio.nombre)}>
                  <FileSpreadsheet className="ic" />
                  Exportar Excel
                </button>
                <button type="button" className="btn btn-q btn-sm" onClick={() => window.print()}>
                  <Printer className="ic" />
                  Imprimir / PDF
                </button>
              </div>
            )}
          </div>

          {periodo === 'rango' ? (
            <div className="rejilla-2 no-print" style={{ gap: 12 }}>
              <Campo etiqueta="Desde" id="r-desde">
                <input id="r-desde" type="date" className="inp" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
              </Campo>
              <Campo etiqueta="Hasta" id="r-hasta">
                <input id="r-hasta" type="date" className="inp" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
              </Campo>
            </div>
          ) : (
            <div className="card reportes-nav-periodo no-print">
              <button
                type="button"
                className="btn btn-g btn-sm"
                aria-label="Periodo anterior"
                onClick={() => setDesplazamiento((x) => x - 1)}
              >
                <ChevronLeft className="ic" />
                Anterior
              </button>
              <div className="reportes-nav-centro">
                <p className="reportes-nav-titulo">{rangoActual.titulo}</p>
                <p className="t-aux num">
                  {d === h ? formatoDia(d) : `Del ${formatoDia(d)} al ${formatoDia(h)}`}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-g btn-sm"
                aria-label="Periodo siguiente"
                disabled={desplazamiento >= 0}
                onClick={() => setDesplazamiento((x) => Math.min(0, x + 1))}
              >
                Siguiente
                <ChevronRight className="ic" />
              </button>
            </div>
          )}

          {periodo === 'rango' && (
            <p className="t-2 num no-print">
              Del {formatoDia(d)} al {formatoDia(h)}
            </p>
          )}

          {usandoRespaldoLocal && r && (
            <AvisoLinea tono="warn" icono={<WifiOff className="ic" />}>
              <strong>Modo local sin conexión</strong>
              Mostrando ventas e ingresos calculados con la información guardada en este dispositivo.
            </AvisoLinea>
          )}

          {enLinea && q.isPending && !r ? (
            <Esqueleto filas={3} texto="Cargando reportes…" />
          ) : enLinea && q.isError && !r ? (
            <ErrorConsulta error={q.error} enLinea={enLinea} reintentar={() => void q.refetch()} />
          ) : (
            r && (
              <>
                <div className="reportes-kpis">
                  <div className="card reportes-kpi reportes-kpi--verde">
                    <div className="reportes-kpi-top">
                      <span className="t-2" style={{ fontWeight: 600 }}>Ventas totales</span>
                      <DeltaComparativa actual={r.ventas.total} previo={r.comparativa.ventasTotal} />
                    </div>
                    <p className="num reportes-kpi-valor" style={{ color: 'var(--color-primario-osc)' }}>
                      {formatoMXN(r.ventas.total)}
                    </p>
                    <p className="t-aux num">
                      {r.ventas.cantidad} {r.ventas.cantidad === 1 ? 'venta' : 'ventas'} · ticket prom. {formatoMXN(r.ventasDetalle.ticketPromedio)}
                    </p>
                  </div>

                  <div className="card reportes-kpi">
                    <div className="reportes-kpi-top">
                      <span className="t-2" style={{ fontWeight: 600 }}>Ingresos recibidos</span>
                      <DeltaComparativa actual={r.ingresosDetalle.totalIngresos} previo={r.comparativa.ingresosTotal} />
                    </div>
                    <p className="num reportes-kpi-valor" style={{ color: '#255a80' }}>
                      {formatoMXN(r.ingresosDetalle.totalIngresos)}
                    </p>
                    <p className="t-aux num">
                      Contado {formatoMXN(r.ingresosDetalle.ventasContado)} · Abonos {formatoMXN(r.ingresosDetalle.abonosDeudas)}
                      {D(r.ventasDetalle.transferenciaPorConfirmar).gt(0) &&
                        ` · ${formatoMXN(r.ventasDetalle.transferenciaPorConfirmar)} por confirmar`}
                    </p>
                  </div>

                  <div className="card reportes-kpi reportes-kpi--ambar">
                    <div className="reportes-kpi-top">
                      <span className="t-2" style={{ fontWeight: 600 }}>Ventas a crédito</span>
                    </div>
                    <p className="num reportes-kpi-valor" style={{ color: '#80520b' }}>
                      {formatoMXN(r.ventasDetalle.credito)}
                    </p>
                    <p className="t-aux num">
                      {r.ventas.aCredito} {r.ventas.aCredito === 1 ? 'venta' : 'ventas'} · Abonado {formatoMXN(r.ingresosDetalle.abonosDeudas)}
                    </p>
                  </div>

                  <div className="card reportes-kpi">
                    <div className="reportes-kpi-top">
                      <span className="t-2" style={{ fontWeight: 600 }}>Balance del periodo</span>
                    </div>
                    <p
                      className="num reportes-kpi-valor"
                      style={{
                        color: D(r.ingresosDetalle.balanceNeto).lt(0) ? 'var(--error-texto)' : 'var(--ok-texto)',
                      }}
                    >
                      {formatoMXNSigno(r.ingresosDetalle.balanceNeto)}
                    </p>
                    <p className="t-aux num">
                      Ingresos {formatoMXN(r.ingresosDetalle.totalIngresos)} − Egresos {formatoMXN(r.ingresosDetalle.egresos)}
                    </p>
                  </div>
                </div>

                <GraficaVentasIngresos serie={r.serie} granularidad={r.granularidad} />

                <div className="reportes-rejilla-2">
                  <section className="card reportes-subcard" aria-label="Origen de ventas e ingresos">
                    <div className="fila">
                      <TrendingUp className="ic" style={{ color: 'var(--color-primario)' }} />
                      <h2 className="t-sec">Origen de ventas e ingresos</h2>
                    </div>
                    <dl>
                      <div className="kv">
                        <dt>Contado efectivo</dt>
                        <dd className="num">{formatoMXN(r.ventasDetalle.contadoEfectivo)}</dd>
                      </div>
                      <div className="kv">
                        <dt>Transferencia confirmada</dt>
                        <dd className="num">{formatoMXN(r.ventasDetalle.contadoTransferencia)}</dd>
                      </div>
                      {D(r.ventasDetalle.transferenciaPorConfirmar).gt(0) && (
                        <div className="kv">
                          <dt>Transferencia por confirmar</dt>
                          <dd className="num" style={{ color: 'var(--aviso-texto)' }}>
                            {formatoMXN(r.ventasDetalle.transferenciaPorConfirmar)}
                          </dd>
                        </div>
                      )}
                      <div className="kv">
                        <dt>Ventas a crédito</dt>
                        <dd className="num">{formatoMXN(r.ventasDetalle.credito)}</dd>
                      </div>
                      <div className="kv">
                        <dt>Abonos a deudas recibidos</dt>
                        <dd className="num" style={{ color: 'var(--ok-texto)' }}>
                          {formatoMXN(r.ingresosDetalle.abonosDeudas)}
                        </dd>
                      </div>
                      <div className="kv">
                        <dt>Otros ingresos en caja</dt>
                        <dd className="num">{formatoMXN(r.ingresosDetalle.otrosIngresos)}</dd>
                      </div>
                      <div className="kv">
                        <dt>Egresos y gastos</dt>
                        <dd className="num" style={{ color: 'var(--error-texto)' }}>
                          {formatoMXN(r.ingresosDetalle.egresos)}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className="card reportes-subcard" aria-label="Productos más vendidos">
                    <div className="fila">
                      <Package className="ic" style={{ color: 'var(--color-primario)' }} />
                      <h2 className="t-sec">Productos más vendidos</h2>
                    </div>
                    {r.topProductos.length === 0 ? (
                      <p className="t-2">No hubo productos vendidos en este periodo.</p>
                    ) : (
                      <div style={{ margin: '0 -16px -16px' }}>
                        {r.topProductos.map((prod, idx) => (
                          <Link key={`${prod.productoId}-${prod.clasificacion}`} className="rowlink" to={`/inventario/${prod.productoId}`}>
                            <span className="bdg b-neu bdg-sm num">#{idx + 1}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontWeight: 600 }}>{prod.nombre}</p>
                              <p className="t-aux">
                                {prod.clasificacion} · {formatoCantidad(prod.cantidad)} {prod.unidad}
                              </p>
                            </div>
                            <p className="num" style={{ fontWeight: 700 }}>
                              {formatoMXN(prod.importe)}
                            </p>
                          </Link>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <div className="card" style={{ overflow: 'hidden' }}>
                  <Tarjeta icono={Receipt} titulo="Ventas" detalle={`${r.ventas.cantidad} ventas · ${r.ventas.aCredito} a crédito`} valor={formatoMXN(r.ventas.total)} />
                  <Tarjeta icono={ShoppingCart} titulo="Compras" detalle={`${r.compras.cantidad} compras · ${r.compras.proveedores} proveedores`} valor={formatoMXN(r.compras.total)} />
                  <Tarjeta icono={Package} titulo="Inventario" detalle={`${r.inventario.bajos} con inventario bajo`} valor={`${r.inventario.productos} productos`} />
                  <Tarjeta
                    icono={Wallet}
                    titulo="Caja y abonos"
                    detalle={`Abonos y otros ${formatoMXN(r.pagos.ingresos)} · Egresos ${formatoMXN(r.pagos.egresos)}`}
                    valor={formatoMXNSigno(D(r.pagos.ingresos).minus(r.pagos.egresos))}
                  />
                  <Tarjeta icono={HandCoins} titulo="Deudas" detalle={`Por cobrar · ${formatoMXN(r.deudas.vencido)} vencido`} valor={formatoMXN(r.deudas.porCobrar)} />
                  <Tarjeta icono={PackageMinus} titulo="Mermas" detalle={`Valor aproximado ${formatoMXN(r.mermas.valor)}`} valor={`${r.mermas.cantidad} ${r.mermas.unidad}`} />
                </div>
              </>
            )
          )}

          {/* Sección: Productores y Comisiones */}
          <div className="card pila-12" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Truck className="ic" style={{ color: 'var(--color-primario)' }} />
              <p style={{ fontWeight: 600, fontSize: 16 }}>Productores y comisiones de consigna</p>
            </div>

            {!enLinea ? (
              <p className="t-aux">El detalle consolidado de liquidaciones a productores requiere conexión.</p>
            ) : qProd.isPending ? (
              <Esqueleto filas={2} />
            ) : qProd.isError ? (
              <ErrorConsulta error={qProd.error} enLinea={enLinea} reintentar={() => void qProd.refetch()} />
            ) : rp ? (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 12,
                    padding: '12px 0',
                    borderBottom: '1px solid var(--borde)',
                  }}
                >
                  <div>
                    <p className="t-aux">Por pagar a productores</p>
                    <p className="num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-error-texto)' }}>
                      {formatoMXN(rp.porPagarTotal)}
                    </p>
                  </div>
                  <div>
                    <p className="t-aux">Comisión ganada del comercio</p>
                    <p className="num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--ok-texto)' }}>
                      {formatoMXN(totalComisionGanada)}
                    </p>
                  </div>
                </div>

                <div className="pila-8" style={{ marginTop: 8 }}>
                  <p className="t-aux" style={{ fontWeight: 600 }}>Desglose por productor en el periodo:</p>
                  {rp.productores.length === 0 ? (
                    <p className="t-aux" style={{ textAlign: 'center', padding: '12px 0' }}>
                      No hubo ventas de productores externos en este periodo.
                    </p>
                  ) : (
                    rp.productores.map((prod) => (
                      <div
                        key={prod.proveedorId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 10px',
                          borderRadius: 6,
                          background: 'var(--fondo-tabla)',
                        }}
                      >
                        <div>
                          <Link
                            to={`/proveedores/${prod.proveedorId}`}
                            style={{ fontWeight: 600, fontSize: 14, color: 'var(--texto)' }}
                          >
                            {prod.nombre}
                          </Link>
                          <p className="t-aux" style={{ fontSize: 12 }}>
                            Vendido: {formatoMXN(prod.totalVendido)} ({formatoCantidad(prod.unidadesVendidas)} unid.) · Comisión:{' '}
                            <span style={{ color: 'var(--ok-texto)', fontWeight: 600 }}>
                              {formatoMXN(prod.comisionGanada)}
                            </span>
                          </p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p className="t-aux">Saldo por pagar</p>
                          <p
                            className="num"
                            style={{
                              fontWeight: 600,
                              color: D(prod.saldoActual).gt(0) ? 'var(--color-error-texto)' : 'var(--texto-3)',
                            }}
                          >
                            {formatoMXN(prod.saldoActual)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : null}
          </div>

          <p className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <ChartColumn className="ic" style={{ width: 14, height: 14 }} />
            Reportes calculados con la fecha del dispositivo de cada operación. Mermas valoradas con el último costo de compra.
          </p>
        </div>
      </main>
    </>
  );
}
