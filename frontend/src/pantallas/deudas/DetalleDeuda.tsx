import { CircleAlert, CircleCheck, Clock, HandCoins, History, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { AvisoLinea, Esqueleto, EstadoVacio } from '../../componentes/Estados';
import { InsigniaDeuda, InsigniaSync } from '../../componentes/Insignias';
import type { Pago } from '@micentralmx/shared/entidades';
import { ETIQUETA_METODO } from '../../dominio/formato';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN } from '../../lib/dinero';
import { formatoDia, formatoFecha, formatoFechaHora, textoDias } from '../../lib/fechas';
import { useDeuda, type DatosDeuda } from './datosDeuda';
import { RegistrarPago } from './RegistrarPago';

function textoVencimiento(venceEl: string | null, deuda: string | null) {
  if (!venceEl) return null;
  const dias = textoDias(venceEl);
  return deuda === 'vencida' ? `Venció el ${formatoDia(venceEl)} · ${dias}` : `Vence el ${formatoDia(venceEl)} · ${dias}`;
}

/** Contenido de la deuda: lo usan la pantalla 11 y el panel de tablet y PC. */
export function ContenidoDeuda({ d, compacto, alPagar }: { d: DatosDeuda; compacto?: boolean; alPagar?: () => void }) {
  const { puede } = useSesionActiva();
  const { v, pagos } = d;
  const pct = D(v.venta.total).gt(0) ? v.pagado.div(v.venta.total).times(100).toNumber() : 0;
  const vencida = v.deuda === 'vencida';
  return (
    <div className="pila-16">
      <section className={compacto ? undefined : 'card'} style={{ padding: compacto ? 0 : 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="fila-entre" style={{ alignItems: 'flex-start' }}>
          <div>
            <p className="t-2">Saldo pendiente</p>
            <p className="num" style={{ fontSize: 34, lineHeight: '40px', fontWeight: 700 }}>
              {formatoMXN(v.saldo)}
            </p>
          </div>
          <div className="pila" style={{ alignItems: 'flex-end', gap: 6 }}>
            {v.deuda && <InsigniaDeuda estado={v.deuda} />}
            <InsigniaSync estado={v.sync} />
          </div>
        </div>
        {v.saldo.gt(0) && v.venta.venceEl && (
          <p className="num" style={{ fontSize: 13, fontWeight: 600, color: vencida ? 'var(--error-texto)' : 'var(--texto-2)', display: 'flex', gap: 6, alignItems: 'center' }}>
            {vencida ? <CircleAlert className="ic" style={{ width: 16, height: 16 }} /> : <Clock className="ic" style={{ width: 16, height: 16 }} />}
            {textoVencimiento(v.venta.venceEl, v.deuda)}
          </p>
        )}
        <div className="pila" style={{ gap: 6 }}>
          <div className="bar">
            <span style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="t-2 num fila-entre">
            <span>
              Pagado <strong style={{ color: 'var(--texto)' }}>{formatoMXN(v.pagado)}</strong>
            </span>
            <span>
              Total original <strong style={{ color: 'var(--texto)' }}>{formatoMXN(v.venta.total)}</strong>
            </span>
          </div>
        </div>
        {compacto && alPagar && v.saldo.gt(0) && puede('pagos.registrar') && (
          <button type="button" className="btn btn-p btn-lg btn-ancho" onClick={alPagar} style={{ boxShadow: '0 4px 12px rgba(15,79,68,.22)' }}>
            <HandCoins className="ic" />
            Registrar pago
          </button>
        )}
      </section>

      {!compacto && (
        <dl className="card" style={{ padding: '4px 16px' }}>
          <div className="kv">
            <dt>Cliente</dt>
            <dd>
              <Link to={`/clientes/${v.venta.clienteId}`}>{v.venta.clienteNombre}</Link>
            </dd>
          </div>
          <div className="kv">
            <dt>Operación</dt>
            <dd>
              <Link to={`/ventas/${v.venta.id}`}>Venta {v.folio}</Link>
            </dd>
          </div>
          <div className="kv">
            <dt>Fecha</dt>
            <dd className="num">{formatoFecha(v.venta.creadoEnDispositivo)}</dd>
          </div>
        </dl>
      )}

      <section className="pila" style={compacto ? { background: 'var(--fondo-tabla)', margin: '0 -20px -16px', padding: '14px 20px', borderTop: '1px solid var(--gris-1)' } : undefined}>
        <div className="fila-entre">
          <h3 className="lbl">Historial de pagos</h3>
          {!compacto && (
            <Link to={`/deudas/${v.venta.id}/historial`} style={{ fontSize: 14, fontWeight: 600 }}>
              Ver todo
            </Link>
          )}
        </div>
        <ol className={compacto ? 'pila-12' : 'card'} style={compacto ? undefined : { overflow: 'hidden' }}>
          {pagos.slice(0, compacto ? 3 : 5).map(({ pago, monto, saldoDespues, sync }) => (
            <li key={pago.id} className={compacto ? 'tl' : 'rowlink'} style={compacto ? undefined : { cursor: 'default' }}>
              <span className="dot cuadro-ic" style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--ok-fondo)', color: 'var(--ok-texto)' }}>
                <CircleCheck className="ic" style={{ width: 16, height: 16 }} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="t-aux num">{formatoFechaHora(pago.creadoEnDispositivo)}</p>
                <p style={{ fontSize: 15, fontWeight: 600 }}>Pago recibido · {ETIQUETA_METODO[pago.metodo]}</p>
                <p className="t-2 num">Saldo restante: {formatoMXN(saldoDespues.lt(0) ? 0 : saldoDespues)}</p>
                <InsigniaSync estado={sync} />
              </div>
              <p className="num" style={{ fontWeight: 700 }}>
                {formatoMXN(monto)}
              </p>
            </li>
          ))}
          {pagos.length === 0 && <li className="t-2" style={{ padding: compacto ? 0 : 14 }}>Todavía no hay pagos.</li>}
        </ol>
        {compacto && (
          <Link className="btn btn-g btn-sm" to={`/deudas/${v.venta.id}/historial`} style={{ alignSelf: 'flex-start', padding: '0 8px' }}>
            <History className="ic" />
            Ver historial completo
          </Link>
        )}
      </section>
    </div>
  );
}

/** Panel lateral de Deudas · Tablet 768 y Deudas · PC 1440. */
export function PanelDeuda({ ventaId, alCerrar }: { ventaId: string; alCerrar: () => void }) {
  const d = useDeuda(ventaId);
  const [pagando, setPagando] = useState(false);
  const [registrado, setRegistrado] = useState<Pago | null>(null);
  if (d === undefined) return <aside className="card" style={{ flex: 1, padding: 20 }}><Esqueleto filas={2} /></aside>;
  if (!d) return null;
  return (
    <aside className="card" aria-label="Detalle de la deuda" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', alignSelf: 'flex-start' }}>
      <div className="fila-entre" style={{ padding: '18px 20px', borderBottom: '1px solid var(--gris-1)', alignItems: 'flex-start' }}>
        <div>
          <h2 className="t-sec">{d.v.venta.clienteNombre}</h2>
          <p className="t-2 num">
            Venta {d.v.folio} · {formatoFecha(d.v.venta.creadoEnDispositivo)}
          </p>
        </div>
        <button type="button" className="icon-btn" aria-label="Cerrar detalle" onClick={alCerrar}>
          <X className="ic" />
        </button>
      </div>
      <div style={{ padding: '16px 20px' }}>
        {registrado && (
          <div style={{ marginBottom: 12 }}>
            <AvisoLinea tono="ok" icono={<CircleCheck className="ic" />}>
              <strong>Pago registrado correctamente</strong>
              {formatoMXN(registrado.monto)} en {ETIQUETA_METODO[registrado.metodo].toLowerCase()} · saldo actualizado
            </AvisoLinea>
          </div>
        )}
        <ContenidoDeuda d={d} compacto alPagar={() => setPagando(true)} />
      </div>
      {pagando && d.v.venta.clienteId && (
        <RegistrarPago
          clienteId={d.v.venta.clienteId}
          clienteNombre={d.v.venta.clienteNombre ?? ''}
          ventaId={d.v.venta.id}
          saldo={d.v.saldo.toString()}
          alCerrar={() => setPagando(false)}
          alRegistrar={(p) => {
            setPagando(false);
            setRegistrado(p);
          }}
        />
      )}
    </aside>
  );
}

/** Pantallas 11 (Detalle de deuda), 12 (Registrar pago) y 13 (Pago registrado). */
export default function DetalleDeuda() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const { puede } = useSesionActiva();
  const d = useDeuda(id);
  const [registrado, setRegistrado] = useState<Pago | null>(null);
  const pagando = params.get('pago') === '1';

  if (d === undefined) {
    return (
      <>
        <EncabezadoSecundario titulo="Deuda" volverA="/deudas" />
        <main className="pag-main con-enc-sec"><Esqueleto filas={2} /></main>
      </>
    );
  }
  if (!d || !d.v.venta.clienteId) {
    return (
      <>
        <EncabezadoSecundario titulo="Deuda" volverA="/deudas" />
        <main className="pag-main con-enc-sec">
          <EstadoVacio titulo="No encontramos la deuda" texto="Puede que ya no esté en este dispositivo." acciones={<Link className="btn btn-q" to="/deudas">Ir a deudas</Link>} />
        </main>
      </>
    );
  }
  const { v } = d;
  return (
    <>
      <EncabezadoSecundario titulo={v.venta.clienteNombre} subtitulo={`Deuda · Venta ${v.folio}`} volverA="/deudas" />
      <main className="pag-main con-enc-sec con-barra">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto' }}>
          {registrado && (
            <AvisoLinea tono="ok" icono={<CircleCheck className="ic" />}>
              <strong>Pago registrado correctamente</strong>
              {formatoMXN(registrado.monto)} en {ETIQUETA_METODO[registrado.metodo].toLowerCase()} · saldo actualizado
              {D(registrado.excedente).gt(0) && ` · ${formatoMXN(registrado.excedente)} como saldo a favor (en revisión)`}
            </AvisoLinea>
          )}
          <ContenidoDeuda d={d} />
        </div>
      </main>
      <div className="barra-accion">
        <Link className="btn btn-q" style={{ flex: 1 }} to={`/deudas/${v.venta.id}/historial`}>
          <History className="ic" />
          Historial
        </Link>
        {v.saldo.gt(0) && puede('pagos.registrar') && (
          <button type="button" className="btn btn-p" style={{ flex: 1.4 }} onClick={() => setParams({ pago: '1' }, { replace: true })}>
            <HandCoins className="ic" />
            Registrar pago
          </button>
        )}
      </div>
      {pagando && (
        <RegistrarPago
          clienteId={v.venta.clienteId!}
          clienteNombre={v.venta.clienteNombre ?? ''}
          ventaId={v.venta.id}
          saldo={v.saldo.toString()}
          alCerrar={() => navegar(`/deudas/${v.venta.id}`, { replace: true })}
          alRegistrar={(p) => {
            setRegistrado(p);
            navegar(`/deudas/${v.venta.id}`, { replace: true });
          }}
        />
      )}
    </>
  );
}
