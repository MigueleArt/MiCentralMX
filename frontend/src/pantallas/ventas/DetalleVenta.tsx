import { useQuery } from '@tanstack/react-query';
import { Ban, CircleAlert, CircleCheck, Ellipsis, HandCoins, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { AvisoLinea, ErrorConsulta, Esqueleto } from '../../componentes/Estados';
import { InsigniaSync, InsigniaVenta } from '../../componentes/Insignias';
import { Dialogo, HojaInferior } from '../../componentes/Superpuestos';
import type { Venta } from '@micentralmx/shared/entidades';
import { vistaVenta, type VentaVista } from '../../dominio/consultas';
import { cancelarVenta, confirmarTransferencia } from '../../dominio/enLinea';
import { cantidadConUnidad, ETIQUETA_FORMA_PAGO } from '../../dominio/formato';
import { useVenta } from '../../hooks/useDatosLocales';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN } from '../../lib/dinero';
import { formatoDia, formatoFechaHora, textoDias } from '../../lib/fechas';
import { useConectividad } from '../../sync/conectividad';

/** Pantalla 09 · Detalle de venta. Las ventas fuera de la retención local se consultan en línea. */
export default function DetalleVenta() {
  const { id } = useParams();
  const local = useVenta(id);
  const { enLinea } = useConectividad();
  const remota = useQuery({
    queryKey: ['venta', id],
    queryFn: () => api<Venta>('GET', `/ventas/${id}`),
    enabled: local === null && !!id,
  });

  if (local === undefined || (local === null && remota.isPending)) {
    return (
      <>
        <EncabezadoSecundario titulo="Venta" volverA="/ventas" />
        <main className="pag-main con-enc-sec">
          <Esqueleto filas={2} />
        </main>
      </>
    );
  }
  if (!local && remota.isError) {
    return (
      <>
        <EncabezadoSecundario titulo="Venta" volverA="/ventas" />
        <main className="pag-main con-enc-sec">
          <ErrorConsulta error={remota.error} enLinea={enLinea} reintentar={() => void remota.refetch()} />
        </main>
      </>
    );
  }
  const v = local ?? vistaVenta(remota.data!, D(0), new Map());
  return <Detalle v={v} />;
}

function Detalle({ v }: { v: VentaVista }) {
  const { puede } = useSesionActiva();
  const { enLinea } = useConectividad();
  const avisar = useAvisos();
  const [menu, setMenu] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const { venta } = v;
  const sinSincronizar = v.sync === 'pendiente' || v.sync === 'enviando';
  const credito = venta.formaPago === 'credito';
  const pct = D(venta.total).gt(0) ? v.pagado.div(venta.total).times(100).toNumber() : 0;
  const puedeCancelar = puede('ventas.cancelar') && venta.estado !== 'cancelada';
  const puedeConfirmar = puede('ventas.confirmar_transferencia') && v.estado === 'por_confirmar';

  const ejecutar = async (accion: () => Promise<unknown>, exito: string) => {
    setTrabajando(true);
    setError(null);
    try {
      await accion();
      avisar(exito);
      setCancelando(false);
      setMenu(false);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setTrabajando(false);
    }
  };

  // Cancelar y confirmar son solo en línea y sobre ventas ya sincronizadas (decisiones técnicas §4.5).
  const motivoNoDisponible = !enLinea ? 'Necesitas conexión.' : sinSincronizar ? 'Primero sincroniza esta venta.' : null;

  return (
    <>
      <EncabezadoSecundario
        titulo={`Venta ${v.folio}`}
        subtitulo={formatoFechaHora(venta.creadoEnDispositivo)}
        volverA="/ventas"
        conSync={false}
        acciones={
          (puedeCancelar || puedeConfirmar) && (
            <button type="button" className="icon-btn" aria-label="Más acciones" onClick={() => setMenu(true)}>
              <Ellipsis className="ic" />
            </button>
          )
        }
      />
      <main className="pag-main con-enc-sec con-barra">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto' }}>
          {(v.requiereRevision || v.sync === 'rechazada') && (
            <AvisoLinea tono={v.sync === 'rechazada' ? 'err' : 'warn'} icono={<TriangleAlert className="ic" />}>
              <strong>{v.sync === 'rechazada' ? 'El servidor rechazó esta venta' : 'En revisión'}</strong>
              {v.motivoSync ?? 'Un administrador la revisará.'}
            </AvisoLinea>
          )}
          <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="fila-entre" style={{ alignItems: 'flex-start' }}>
              <div>
                <p className="t-2">Total de la venta</p>
                <p className="num" style={{ fontSize: 32, lineHeight: '38px', fontWeight: 700 }}>
                  {formatoMXN(venta.total)}
                </p>
              </div>
              <div className="pila" style={{ alignItems: 'flex-end', gap: 6 }}>
                <InsigniaVenta estado={v.estado} />
                <InsigniaSync estado={v.sync} />
              </div>
            </div>
            {credito && venta.estado !== 'cancelada' && (
              <div className="pila" style={{ gap: 6 }}>
                <div className="bar">
                  <span style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
                <div className="t-2 num fila-entre">
                  <span>
                    Pagado <strong style={{ color: 'var(--texto)' }}>{formatoMXN(v.pagado)}</strong>
                  </span>
                  <span>
                    Saldo <strong style={{ color: 'var(--texto)' }}>{formatoMXN(v.saldo)}</strong>
                  </span>
                </div>
              </div>
            )}
          </section>

          <dl className="card" style={{ padding: '4px 16px' }}>
            <div className="kv">
              <dt>Cliente</dt>
              <dd>{venta.clienteId ? <Link to={`/clientes/${venta.clienteId}`}>{venta.clienteNombre}</Link> : 'Venta de mostrador'}</dd>
            </div>
            <div className="kv">
              <dt>Forma de pago</dt>
              <dd>{credito ? 'Crédito' : `Contado · ${ETIQUETA_FORMA_PAGO[venta.formaPago]}`}</dd>
            </div>
            {venta.venceEl && (
              <div className="kv">
                <dt>Vence</dt>
                <dd className="num">
                  {formatoDia(venta.venceEl)} · {textoDias(venta.venceEl)}
                </dd>
              </div>
            )}
            <div className="kv">
              <dt>Registró</dt>
              <dd>{venta.usuarioNombre}</dd>
            </div>
            {venta.canceladaEn && (
              <div className="kv">
                <dt>Cancelada</dt>
                <dd className="num">{formatoFechaHora(venta.canceladaEn)}</dd>
              </div>
            )}
          </dl>

          <section className="pila">
            <h2 className="lbl">Qué se vendió</h2>
            <div className="card" style={{ overflow: 'hidden' }}>
              {venta.renglones.map((r, i) => (
                <div key={i} className="rowlink" style={{ cursor: 'default' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600 }}>{r.productoNombre}</p>
                    <p className="t-aux num">
                      {r.clasificacionNombre} · {cantidadConUnidad(r.cantidad, { nombre: r.unidadNombre, plural: r.unidadPlural })} × {formatoMXN(r.precio)}
                      {!D(r.precio).eq(r.precioReferencia) && ` (catálogo ${formatoMXN(r.precioReferencia)})`}
                    </p>
                  </div>
                  <p className="num" style={{ fontWeight: 700 }}>
                    {formatoMXN(r.importe)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      {credito && venta.estado !== 'cancelada' && (
        <div className="barra-accion">
          <Link className="btn btn-q" style={{ flex: 1 }} to={`/deudas/${venta.id}`}>
            Ver deuda
          </Link>
          {v.saldo.gt(0) && puede('pagos.registrar') && (
            <Link className="btn btn-p" style={{ flex: 1.4 }} to={`/deudas/${venta.id}?pago=1`}>
              <HandCoins className="ic" />
              Registrar pago
            </Link>
          )}
        </div>
      )}

      {menu && (
        <HojaInferior titulo="Acciones de la venta" alCerrar={() => setMenu(false)}>
          {motivoNoDisponible && <AvisoLinea tono="info">{motivoNoDisponible}</AvisoLinea>}
          {error && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{error}</AvisoLinea>}
          {puedeConfirmar && (
            <button type="button" className="btn btn-s" disabled={!!motivoNoDisponible || trabajando} onClick={() => void ejecutar(() => confirmarTransferencia(venta.id), 'Transferencia confirmada')}>
              <CircleCheck className="ic" />
              Confirmar transferencia
            </button>
          )}
          {puedeCancelar && (
            <button type="button" className="btn btn-d" disabled={!!motivoNoDisponible} onClick={() => { setMenu(false); setCancelando(true); }}>
              <Ban className="ic" />
              Cancelar venta
            </button>
          )}
        </HojaInferior>
      )}

      {cancelando && (
        <Dialogo
          titulo={`¿Cancelar la venta ${v.folio}?`}
          tono="peligro"
          icono={<Ban className="ic" />}
          alCerrar={() => setCancelando(false)}
          acciones={
            <>
              <button type="button" className="btn btn-d" disabled={trabajando || !motivo.trim()} onClick={() => void ejecutar(() => cancelarVenta(venta.id, motivo.trim()), 'Venta cancelada')}>
                Cancelar venta
              </button>
              <button type="button" className="btn btn-q" onClick={() => setCancelando(false)}>
                Volver
              </button>
            </>
          }
        >
          <p className="t-2" style={{ fontSize: 15 }}>
            La venta no se borra: cambia a “Cancelada” y la mercancía regresa al inventario.
          </p>
          <label className="flabel" htmlFor="motivo-cancelar" style={{ marginTop: 8 }}>
            Motivo
          </label>
          <input id="motivo-cancelar" className="inp" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. El cliente devolvió la mercancía" />
          {error && <p className="err-msg">{error}</p>}
        </Dialogo>
      )}
    </>
  );
}
