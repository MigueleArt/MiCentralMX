import { useQuery } from '@tanstack/react-query';
import { ChartColumn, HandCoins, Package, PackageMinus, Receipt, ShoppingCart, Truck, Wallet, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/cliente';
import { ErrorConsulta, Esqueleto } from '../../componentes/Estados';
import { Campo, Chips } from '../../componentes/Formulario';
import type { ReporteProductores, ResumenReportes } from '@micentralmx/shared/api';
import { useFormato } from '../../hooks/useFormato';
import { EncabezadoPagina, EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoCantidad, formatoMXN, formatoMXNSigno, sumar } from '../../lib/dinero';
import { diaLocal, formatoDia, sumarDias } from '../../lib/fechas';
import { useConectividad } from '../../sync/conectividad';

type Periodo = 'hoy' | 'semana' | 'quincena' | 'mes' | 'rango';

function rango(p: Periodo, desde: string, hasta: string): [string, string] {
  const hoy = diaLocal();
  if (p === 'hoy') return [hoy, hoy];
  if (p === 'semana') return [sumarDias(hoy, -6), hoy];
  if (p === 'quincena') {
    const dia = Number(hoy.slice(8, 10));
    const añoMes = hoy.slice(0, 8);
    const inicioQ = dia <= 15 ? `${añoMes}01` : `${añoMes}16`;
    return [inicioQ, hoy];
  }
  if (p === 'mes') return [`${hoy.slice(0, 8)}01`, hoy];
  return [desde, hasta];
}

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

/** Pantalla 26 · Reportes consolidados (solo en línea, decisiones técnicas §4.5). */
export default function Reportes() {
  const formato = useFormato();
  const { enLinea } = useConectividad();
  const [periodo, setPeriodo] = useState<Periodo>('semana');
  const [desde, setDesde] = useState(sumarDias(diaLocal(), -6));
  const [hasta, setHasta] = useState(diaLocal());
  const [d, h] = rango(periodo, desde, hasta);

  const q = useQuery({
    queryKey: ['reportes', d, h],
    queryFn: () => api<ResumenReportes>('GET', `/reportes/resumen?desde=${d}&hasta=${h}`),
  });

  const qProd = useQuery({
    queryKey: ['reportes-productores', d, h],
    queryFn: () => api<ReporteProductores>('GET', `/reportes/productores?desde=${d}&hasta=${h}`),
  });

  const r = q.data;
  const rp = qProd.data;
  const totalComisionGanada = rp ? sumar(rp.productores.map((p) => p.comisionGanada)) : D(0);

  return (
    <>
      {formato === 'telefono' ? <EncabezadoSecundario titulo="Reportes" volverA="/mas" /> : <EncabezadoPagina titulo="Reportes" />}
      <main className={`pag-main${formato === 'telefono' ? ' con-enc-sec' : ''}`}>
        <div className="pila-16" style={{ maxWidth: 960 }}>
          <Chips<Periodo>
            etiqueta="Periodo"
            valor={periodo}
            alCambiar={setPeriodo}
            opciones={[
              { valor: 'hoy', texto: 'Hoy' },
              { valor: 'semana', texto: 'Esta semana' },
              { valor: 'quincena', texto: 'Esta quincena' },
              { valor: 'mes', texto: 'Este mes' },
              { valor: 'rango', texto: 'Elegir fechas' },
            ]}
          />
          {periodo === 'rango' && (
            <div className="rejilla-2" style={{ gap: 12 }}>
              <Campo etiqueta="Desde" id="r-desde">
                <input id="r-desde" type="date" className="inp" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
              </Campo>
              <Campo etiqueta="Hasta" id="r-hasta">
                <input id="r-hasta" type="date" className="inp" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
              </Campo>
            </div>
          )}
          <p className="t-2 num">
            Del {formatoDia(d)} al {formatoDia(h)}
          </p>

          {q.isPending ? (
            <Esqueleto filas={3} texto="Cargando reportes…" />
          ) : q.isError ? (
            <ErrorConsulta error={q.error} enLinea={enLinea} reintentar={() => void q.refetch()} />
          ) : (
            r && (
              <div className="card" style={{ overflow: 'hidden' }}>
                <Tarjeta icono={Receipt} titulo="Ventas" detalle={`${r.ventas.cantidad} ventas · ${r.ventas.aCredito} a crédito`} valor={formatoMXN(r.ventas.total)} />
                <Tarjeta icono={ShoppingCart} titulo="Compras" detalle={`${r.compras.cantidad} compras · ${r.compras.proveedores} proveedores`} valor={formatoMXN(r.compras.total)} />
                <Tarjeta icono={Package} titulo="Inventario" detalle={`${r.inventario.bajos} con inventario bajo`} valor={`${r.inventario.productos} productos`} />
                <Tarjeta
                  icono={Wallet}
                  titulo="Pagos"
                  detalle={`Ingresos ${formatoMXN(r.pagos.ingresos)} · Egresos ${formatoMXN(r.pagos.egresos)}`}
                  valor={formatoMXNSigno(D(r.pagos.ingresos).minus(r.pagos.egresos))}
                />
                <Tarjeta icono={HandCoins} titulo="Deudas" detalle={`Por cobrar · ${formatoMXN(r.deudas.vencido)} vencido`} valor={formatoMXN(r.deudas.porCobrar)} />
                <Tarjeta icono={PackageMinus} titulo="Mermas" detalle={`Valor aproximado ${formatoMXN(r.mermas.valor)}`} valor={`${r.mermas.cantidad} ${r.mermas.unidad}`} />
              </div>
            )
          )}

          {/* Sección: Productores y Comisiones */}
          <div className="card pila-12" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Truck className="ic" style={{ color: 'var(--primario)' }} />
              <p style={{ fontWeight: 600, fontSize: 16 }}>Productores y comisiones de consigna</p>
            </div>

            {qProd.isPending ? (
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
                    <p className="num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--peligro, #dc2626)' }}>
                      {formatoMXN(rp.porPagarTotal)}
                    </p>
                  </div>
                  <div>
                    <p className="t-aux">Comisión ganada del comercio</p>
                    <p className="num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--exito, #16a34a)' }}>
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
                          background: 'var(--fondo-superficie)',
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
                            <span style={{ color: 'var(--exito, #16a34a)', fontWeight: 600 }}>
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
                              color: D(prod.saldoActual).gt(0) ? 'var(--peligro, #dc2626)' : 'var(--texto-tenue)',
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
            Reportes calculados en el servidor con la fecha del dispositivo de cada operación. Mermas valoradas con el último costo de compra.
          </p>
        </div>
      </main>
    </>
  );
}

