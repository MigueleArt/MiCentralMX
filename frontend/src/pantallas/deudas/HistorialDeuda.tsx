import { CircleAlert, CircleCheck, Receipt } from 'lucide-react';
import { useParams } from 'react-router';
import { Esqueleto } from '../../componentes/Estados';
import { InsigniaSync } from '../../componentes/Insignias';
import { ETIQUETA_METODO } from '../../dominio/formato';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN } from '../../lib/dinero';
import { diaLocal, formatoDia, formatoFechaHora } from '../../lib/fechas';
import { useDeuda } from './datosDeuda';

/** Pantalla 14 · Historial de deuda: pagos, vencimiento y creación. */
export default function HistorialDeuda() {
  const { id } = useParams();
  const d = useDeuda(id);
  if (!d) {
    return (
      <>
        <EncabezadoSecundario titulo="Historial de la deuda" volverA={`/deudas/${id}`} />
        <main className="pag-main con-enc-sec">{d === undefined ? <Esqueleto filas={3} /> : <p>No encontramos la deuda.</p>}</main>
      </>
    );
  }
  const { v, pagos } = d;
  const vence = v.venta.venceEl;
  // Saldo al vencer: total menos lo pagado hasta ese día.
  const vencio = vence && vence < diaLocal();
  const saldoAlVencer = vencio
    ? D(v.venta.total).minus(pagos.filter((p) => diaLocal(p.pago.creadoEnDispositivo) <= vence).reduce((a, p) => a.plus(p.monto), D(0)))
    : null;

  type Evento = { clave: string; dia: string; nodo: React.ReactNode };
  const eventos: Evento[] = [
    ...pagos.map(({ pago, monto, saldoDespues, sync }) => ({
      clave: pago.id,
      dia: pago.creadoEnDispositivo,
      nodo: (
        <>
          <span className="dot" style={{ background: 'var(--ok-fondo)', color: 'var(--ok-texto)' }}>
            <CircleCheck className="ic" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="t-aux num">{formatoFechaHora(pago.creadoEnDispositivo)}</p>
            <p style={{ fontSize: 15, fontWeight: 600 }}>Pago recibido · {ETIQUETA_METODO[pago.metodo]}</p>
            <p className="t-2 num">
              Saldo restante: {formatoMXN(saldoDespues.lt(0) ? 0 : saldoDespues)} · Registró {pago.usuarioNombre}
            </p>
            {pago.nota && <p className="t-2">“{pago.nota}”</p>}
            <InsigniaSync estado={sync} />
          </div>
          <p className="num" style={{ fontWeight: 700 }}>
            {formatoMXN(monto)}
          </p>
        </>
      ),
    })),
    ...(vencio && saldoAlVencer && saldoAlVencer.gt(0)
      ? [
          {
            clave: 'vencio',
            dia: `${vence}T23:59:59`,
            nodo: (
              <>
                <span className="dot" style={{ background: 'var(--error-fondo)', color: 'var(--error-texto)' }}>
                  <CircleAlert className="ic" />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="t-aux num">{formatoDia(vence!)}</p>
                  <p style={{ fontSize: 15, fontWeight: 600 }}>La deuda venció</p>
                  <p className="t-2 num">Saldo en ese momento: {formatoMXN(saldoAlVencer)}</p>
                </div>
              </>
            ),
          },
        ]
      : []),
    {
      clave: 'creada',
      dia: v.venta.creadoEnDispositivo,
      nodo: (
        <>
          <span className="dot" style={{ background: 'var(--gris-1)', color: 'var(--texto-neutro)' }}>
            <Receipt className="ic" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="t-aux num">{formatoFechaHora(v.venta.creadoEnDispositivo)}</p>
            <p style={{ fontSize: 15, fontWeight: 600 }}>Deuda creada · Venta {v.folio}</p>
            {vence && <p className="t-2 num">Vencimiento: {formatoDia(vence)}</p>}
          </div>
          <p className="num" style={{ fontWeight: 700 }}>
            {formatoMXN(v.venta.total)}
          </p>
        </>
      ),
    },
  ];
  eventos.sort((a, b) => b.dia.localeCompare(a.dia));

  return (
    <>
      <EncabezadoSecundario titulo="Historial de la deuda" subtitulo={`${v.venta.clienteNombre} · Venta ${v.folio}`} volverA={`/deudas/${v.venta.id}`} />
      <main className="pag-main con-enc-sec">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto' }}>
          <div className="card rejilla-2" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', padding: '14px 16px' }}>
            <div>
              <p className="t-aux">Total original</p>
              <p className="num" style={{ fontWeight: 700, fontSize: 17 }}>{formatoMXN(v.venta.total)}</p>
            </div>
            <div>
              <p className="t-aux">Pagado</p>
              <p className="num" style={{ fontWeight: 700, fontSize: 17 }}>{formatoMXN(v.pagado)}</p>
            </div>
            <div>
              <p className="t-aux">Saldo</p>
              <p className="num" style={{ fontWeight: 700, fontSize: 17 }}>{formatoMXN(v.saldo)}</p>
            </div>
          </div>
          <ol className="card pila-16" style={{ padding: 16 }}>
            {eventos.map((e) => (
              <li key={e.clave} className="tl">
                {e.nodo}
              </li>
            ))}
          </ol>
        </div>
      </main>
    </>
  );
}
