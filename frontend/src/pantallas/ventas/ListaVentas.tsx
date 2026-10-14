import { ChevronRight, HandCoins } from 'lucide-react';
import { Link } from 'react-router';
import { InsigniaSync, InsigniaVenta } from '../../componentes/Insignias';
import type { VentaVista } from '../../dominio/consultas';
import { ETIQUETA_FORMA_PAGO } from '../../dominio/formato';
import { formatoMXN } from '../../lib/dinero';
import { formatoDia, formatoFechaHora, formatoHora } from '../../lib/fechas';

const cliente = (v: VentaVista) => v.venta.clienteNombre ?? 'Venta de mostrador';
const tipoPago = (v: VentaVista) =>
  v.venta.formaPago === 'credito'
    ? `Crédito${v.venta.venceEl ? ` · vence ${formatoDia(v.venta.venceEl)}` : ''}`
    : `Contado · ${ETIQUETA_FORMA_PAGO[v.venta.formaPago]}`;

/** Tarjeta de venta del teléfono (pantalla 05). */
export function TarjetaVenta({ v, puedeCobrar }: { v: VentaVista; puedeCobrar: boolean }) {
  const cobrar = puedeCobrar && v.estado === 'a_credito';
  return (
    <article className="card" style={{ padding: '14px 14px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="fila-entre" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <p className="t-aux num">
            Venta {v.folio} · {formatoHora(v.venta.creadoEnDispositivo)}
          </p>
          <p style={{ fontSize: 16, fontWeight: 600, lineHeight: '22px', marginTop: 2 }}>{cliente(v)}</p>
          <p className="t-2">{tipoPago(v)}</p>
        </div>
        <p className="num" style={{ fontSize: 20, fontWeight: 700, lineHeight: '26px' }}>
          {formatoMXN(v.venta.total)}
        </p>
      </div>
      <div className="fila-entre" style={{ flexWrap: 'wrap' }}>
        <div className="fila" style={{ flexWrap: 'wrap', gap: 6 }}>
          <InsigniaSync estado={v.sync} />
          <InsigniaVenta estado={v.estado} />
        </div>
        {!cobrar && (
          <Link className="btn btn-g btn-sm" to={`/ventas/${v.venta.id}`} style={{ padding: '0 6px 0 10px' }}>
            Ver detalle
            <ChevronRight className="ic" />
          </Link>
        )}
      </div>
      {cobrar && (
        <div className="fila" style={{ paddingBottom: 4 }}>
          <Link className="btn btn-s btn-sm" to={`/deudas/${v.venta.id}?pago=1`} style={{ flex: 1 }}>
            <HandCoins className="ic" />
            Registrar pago
          </Link>
          <Link to={`/ventas/${v.venta.id}`} className="enlace" style={{ padding: '0 8px' }}>
            Ver detalle
          </Link>
        </div>
      )}
    </article>
  );
}

/** Tabla de ventas de tablet (768) y PC (1440). */
export function TablaVentas({ ventas, completa, puedeCobrar }: { ventas: VentaVista[]; completa: boolean; puedeCobrar: boolean }) {
  return (
    <div className="card tabla-card">
      <div className="tabla-scroll">
        <table className="tbl tbl-c">
          <thead>
            <tr>
              <th>Venta</th>
              <th>Cliente</th>
              {completa && <th>Fecha</th>}
              <th className="r">Total</th>
              {completa && <th>Tipo</th>}
              <th>Estado</th>
              <th className="r">Acción</th>
            </tr>
          </thead>
          <tbody>
            {ventas.map((v) => (
              <tr key={v.venta.id}>
                <td>
                  <p className="num" style={{ fontWeight: 600 }}>
                    {v.folio}
                  </p>
                  {!completa && <p className="t-aux num">{formatoHora(v.venta.creadoEnDispositivo)}</p>}
                </td>
                <td>
                  <p style={{ fontWeight: 600 }}>{cliente(v)}</p>
                  {!completa && <p className="t-aux">{v.venta.formaPago === 'credito' ? 'Crédito' : 'Contado'}</p>}
                </td>
                {completa && <td className="num">{formatoFechaHora(v.venta.creadoEnDispositivo).replace(' · ', ' ')}</td>}
                <td className="r num" style={{ fontWeight: 700 }}>
                  {formatoMXN(v.venta.total)}
                </td>
                {completa && <td>{v.venta.formaPago === 'credito' ? 'Crédito' : 'Contado'}</td>}
                <td>
                  <div className="fila" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <InsigniaVenta estado={v.estado} />
                    <InsigniaSync estado={v.sync} />
                  </div>
                </td>
                <td className="r">
                  <div className="fila" style={{ justifyContent: 'flex-end' }}>
                    {completa && puedeCobrar && v.estado === 'a_credito' && (
                      <Link className="btn btn-s btn-sm" to={`/deudas/${v.venta.id}?pago=1`}>
                        Registrar pago
                      </Link>
                    )}
                    <Link className="btn btn-g btn-sm" to={`/ventas/${v.venta.id}`}>
                      Ver detalle
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
