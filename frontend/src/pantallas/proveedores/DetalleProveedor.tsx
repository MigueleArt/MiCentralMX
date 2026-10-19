import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calculator,
  Coins,
  FileSpreadsheet,
  HandCoins,
  Pencil,
  Phone,
  Scale,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Segmentado } from '../../componentes/Formulario';
import { estadoCuentaProductorLocal } from '../../dominio/consultas';
import { folioLiquidacion } from '../../dominio/formato';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { formatoMXN } from '../../lib/dinero';
import { formatoDia, formatoRelativo } from '../../lib/fechas';
import { RegistrarMovimiento } from '../pagos/RegistrarMovimiento';

export default function DetalleProveedor() {
  const { id } = useParams();
  const { puede } = useSesionActiva();
  const avisar = useAvisos();
  const [pestana, setPestana] = useState<'estado_cuenta' | 'cortes'>('estado_cuenta');
  const [modalDinero, setModalDinero] = useState<'pago_proveedor' | 'anticipo_productor' | null>(null);

  const datos = useLiveQuery(async () => {
    if (!id) return null;
    return estadoCuentaProductorLocal(id);
  }, [id]);

  if (datos === undefined) {
    return (
      <>
        <EncabezadoSecundario titulo="Productor / Proveedor" volverA="/proveedores" />
        <main className="pag-main con-enc-sec"><Esqueleto filas={3} /></main>
      </>
    );
  }

  if (!datos) {
    return (
      <>
        <EncabezadoSecundario titulo="Productor" volverA="/proveedores" />
        <main className="pag-main con-enc-sec">
          <EstadoVacio
            titulo="No encontramos al proveedor o rancho"
            texto="Puede que haya sido archivado o eliminado."
            acciones={<Link className="btn btn-q" to="/proveedores">Ir a proveedores</Link>}
          />
        </main>
      </>
    );
  }

  const { proveedor, saldo, totalLiquidado, totalAjustes, totalPagos, totalAnticipos, movimientos, cortes } = datos;
  const esRancho = proveedor.tipo === 'rancho_propio';

  const textoComision = () => {
    if (esRancho) return 'Rancho propio · Sin comisión ni cuenta por pagar';
    if (!proveedor.comisionTipo) return 'Sin comisión por omisión';
    if (proveedor.comisionTipo === 'porcentaje') return `Comisión por omisión: ${proveedor.comisionValor ?? 0}%`;
    return `Comisión por omisión: $${proveedor.comisionValor ?? 0} por unidad`;
  };

  return (
    <>
      <EncabezadoSecundario
        titulo={proveedor.nombre}
        subtitulo={esRancho ? 'Rancho propio' : 'Productor externo'}
        volverA="/proveedores"
        acciones={
          puede('proveedores.gestionar') ? (
            <Link className="btn-icono" to={`/proveedores/${proveedor.id}/editar`} aria-label="Editar">
              <Pencil className="ic" />
            </Link>
          ) : undefined
        }
      />

      <main className="pag-main con-enc-sec con-barra">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto' }}>
          {/* Tarjeta de Saldo */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <p className="t-aux">{esRancho ? 'Origen' : saldo.lt(0) ? 'Saldo a favor' : 'Por pagar al productor'}</p>
                <p
                  className="num"
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: esRancho
                      ? 'var(--texto)'
                      : saldo.gt(0)
                        ? 'var(--peligro, #dc2626)'
                        : 'var(--texto-tenue)',
                  }}
                >
                  {esRancho ? 'Rancho propio' : formatoMXN(saldo.abs())}
                </p>
                <p className="t-aux" style={{ marginTop: 4 }}>
                  {textoComision()}
                </p>
                {proveedor.telefono && (
                  <p className="t-aux" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <Phone className="ic" style={{ width: 14, height: 14 }} /> {proveedor.telefono}
                  </p>
                )}
              </div>
            </div>

            {!esRancho && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: 12,
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: '1px solid var(--borde-tarjeta, #e5e7eb)',
                }}
              >
                <div>
                  <p className="t-aux">Total liquidado</p>
                  <p className="num" style={{ fontWeight: 600 }}>{formatoMXN(totalLiquidado)}</p>
                </div>
                <div>
                  <p className="t-aux">Pagos entregados</p>
                  <p className="num" style={{ fontWeight: 600, color: 'var(--primario)' }}>{formatoMXN(totalPagos)}</p>
                </div>
                <div>
                  <p className="t-aux">Anticipos</p>
                  <p className="num" style={{ fontWeight: 600 }}>{formatoMXN(totalAnticipos)}</p>
                </div>
                <div>
                  <p className="t-aux">Ajustes netos</p>
                  <p className="num" style={{ fontWeight: 600 }}>{formatoMXN(totalAjustes)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Acciones Rápidas */}
          {!esRancho && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {puede('liquidaciones.gestionar') && (
                <Link className="btn btn-p" to={`/proveedores/${proveedor.id}/corte/nuevo`} style={{ flex: '1 1 140px' }}>
                  <Calculator className="ic" />
                  Nuevo corte
                </Link>
              )}
              {puede('pagos.registrar') && (
                <>
                  <button
                    type="button"
                    className="btn btn-s"
                    style={{ flex: '1 1 120px' }}
                    onClick={() => setModalDinero('pago_proveedor')}
                  >
                    <HandCoins className="ic" />
                    Registrar pago
                  </button>
                  <button
                    type="button"
                    className="btn btn-s"
                    style={{ flex: '1 1 120px' }}
                    onClick={() => setModalDinero('anticipo_productor')}
                  >
                    <Coins className="ic" />
                    Registrar anticipo
                  </button>
                </>
              )}
              {puede('liquidaciones.gestionar') && (
                <Link
                  className="btn btn-s"
                  to={`/proveedores/${proveedor.id}/ajuste`}
                  style={{ flex: '1 1 120px' }}
                >
                  <Scale className="ic" />
                  Cargo / abono
                </Link>
              )}
            </div>
          )}

          {!esRancho && (
            <Segmentado<'estado_cuenta' | 'cortes'>
              etiqueta="Vista"
              valor={pestana}
              alCambiar={setPestana}
              opciones={[
                { valor: 'estado_cuenta', texto: `Estado de cuenta (${movimientos.length})` },
                { valor: 'cortes', texto: `Cortes emitidos (${cortes.length})` },
              ]}
            />
          )}

          {/* Pestaña: Estado de Cuenta Cronológico */}
          {!esRancho && pestana === 'estado_cuenta' && (
            <div className="pila-12">
              <div
                style={{
                  padding: '8px 12px',
                  background: 'var(--fondo-superficie, #f9fafb)',
                  border: '1px solid var(--borde-tarjeta, #e5e7eb)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: 'var(--texto-tenue)',
                }}
              >
                Nota: Los pagos y anticipos cubren los cortes por orden de antigüedad (FIFO). Los cargos y abonos ajustan el saldo global de la cuenta, no el estado individual de cada corte.
              </div>
              <div className="card" style={{ overflow: 'hidden' }}>
              {movimientos.length === 0 ? (
                <EstadoVacio
                  icono={FileSpreadsheet}
                  titulo="Sin movimientos registrados"
                  texto="Aquí aparecerán los cortes, pagos, anticipos y ajustes en orden cronológico."
                />
              ) : (
                movimientos.map((m) => {
                  const esCorte = m.tipo === 'corte';
                  const esPago = m.tipo === 'pago';
                  const esAnticipo = m.tipo === 'anticipo';
                  const esCargo = m.tipo === 'cargo';

                  return (
                    <div
                      key={m.id}
                      className="rowlink"
                      style={{ cursor: 'default', display: 'flex', alignItems: 'center', gap: 12 }}
                    >
                      <span
                        className="ib"
                        style={{
                          background: esCorte
                            ? 'var(--primario-fondo)'
                            : esPago || esAnticipo
                              ? '#ecfdf5'
                              : esCargo
                                ? '#fef2f2'
                                : '#f0fdf4',
                          color: esCorte
                            ? 'var(--primario)'
                            : esPago || esAnticipo
                              ? '#059669'
                              : esCargo
                                ? '#dc2626'
                                : '#16a34a',
                        }}
                      >
                        {esCorte ? (
                          <Calculator className="ic" />
                        ) : esPago || esAnticipo ? (
                          <ArrowDownLeft className="ic" />
                        ) : (
                          <ArrowUpRight className="ic" />
                        )}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <p style={{ fontWeight: 600 }}>{m.concepto}</p>
                          {esCorte && m.estadoCorte && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: '1px 6px',
                                borderRadius: 4,
                                background:
                                  m.estadoCorte === 'pagado'
                                    ? '#dcfce7'
                                    : m.estadoCorte === 'parcial'
                                      ? '#fef9c3'
                                      : '#fee2e2',
                                color:
                                  m.estadoCorte === 'pagado'
                                    ? '#15803d'
                                    : m.estadoCorte === 'parcial'
                                      ? '#854d0e'
                                      : '#b91c1c',
                                fontWeight: 600,
                              }}
                            >
                              {m.estadoCorte.toUpperCase()}
                            </span>
                          )}
                          {esCorte && (m as any).comisionTipo === 'mixta' && (
                            <span
                              style={{
                                fontSize: 10,
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: '#f3e8ff',
                                color: '#7e22ce',
                                fontWeight: 600,
                              }}
                            >
                              MIXTA
                            </span>
                          )}
                        </div>
                        <p className="t-aux">{formatoDia(m.fecha)} · {formatoRelativo(m.fecha)}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p
                          className="t-2 num"
                          style={{
                            fontWeight: 600,
                            color: m.abono.gt(0) ? 'var(--peligro, #dc2626)' : 'var(--exito, #16a34a)',
                          }}
                        >
                          {m.abono.gt(0) ? `+${formatoMXN(m.abono)}` : `−${formatoMXN(m.cargo)}`}
                        </p>
                        <p className="t-aux num">Saldo: {formatoMXN(m.saldoCorrido)}</p>
                      </div>
                    </div>
                  );
                })
              )}
              </div>
            </div>
          )}

          {/* Pestaña: Cortes emitidos */}
          {!esRancho && pestana === 'cortes' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              {cortes.length === 0 ? (
                <EstadoVacio
                  icono={Calculator}
                  titulo="Sin cortes emitidos"
                  texto="Emite un nuevo corte para calcular la comisión y los descuentos de las ventas acumuladas."
                />
              ) : (
                cortes.map(({ liquidacion: l, estado, montoCubierto, saldoRestante }) => (
                  <div
                    key={l.id}
                    className="rowlink"
                    style={{ cursor: 'default', display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <span className="ib">
                      <Calculator className="ic" />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <p style={{ fontWeight: 600 }}>{folioLiquidacion(l)}</p>
                        <span
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background:
                              estado === 'pagado' ? '#dcfce7' : estado === 'parcial' ? '#fef9c3' : '#fee2e2',
                            color:
                              estado === 'pagado' ? '#15803d' : estado === 'parcial' ? '#854d0e' : '#b91c1c',
                            fontWeight: 600,
                          }}
                        >
                          {estado.toUpperCase()}
                        </span>
                        {l.comisionTipo === 'mixta' && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: '#f3e8ff',
                              color: '#7e22ce',
                              fontWeight: 600,
                            }}
                          >
                            MIXTA
                          </span>
                        )}
                      </div>
                      <p className="t-aux">
                        Vendido: {formatoMXN(l.totalVendido)} · Comisión {l.comisionTipo === 'mixta' ? '(mixta)' : ''}: {formatoMXN(l.comisionFinal)} · Cubierto: {formatoMXN(montoCubierto)}
                      </p>
                      <p className="t-aux" style={{ fontSize: 12 }}>
                        {formatoDia(l.creadoEn)}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p className="t-aux">Neto del corte</p>
                      <p className="t-2 num" style={{ fontWeight: 600 }}>{formatoMXN(l.neto)}</p>
                      {estado !== 'pagado' && (
                        <p className="t-aux num" style={{ color: '#b91c1c' }}>
                          Resta: {formatoMXN(saldoRestante)}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </main>

      {/* Modal para Registrar Pago o Anticipo */}
      {modalDinero && (
        <RegistrarMovimiento
          alCerrar={() => setModalDinero(null)}
          alRegistrar={(msg) => {
            setModalDinero(null);
            avisar(msg);
          }}
          proveedorIdInicial={proveedor.id}
          categoriaInicial={modalDinero}
        />
      )}
    </>
  );
}
