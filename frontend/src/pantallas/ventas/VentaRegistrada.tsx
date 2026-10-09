import { CircleCheck, CloudUpload, Plus } from 'lucide-react';
import { Link, useLocation, useParams } from 'react-router';
import { AvisoLinea, Esqueleto } from '../../componentes/Estados';
import { cantidadConUnidad, ETIQUETA_FORMA_PAGO } from '../../dominio/formato';
import { useVenta } from '../../hooks/useDatosLocales';
import { formatoMXN } from '../../lib/dinero';
import { formatoDia, formatoHora } from '../../lib/fechas';

/** Pantalla 08 · Venta registrada. */
export default function VentaRegistrada() {
  const { id } = useParams();
  const { state } = useLocation() as { state?: { sinConexion?: boolean } };
  const v = useVenta(id);
  if (v === undefined) return <main className="pag-main" style={{ paddingTop: 24 }}><Esqueleto filas={2} /></main>;
  if (!v) return <main className="pag-main" style={{ paddingTop: 24 }}><p>No encontramos la venta.</p></main>;
  const { venta } = v;
  const pendiente = v.sync === 'pendiente' || v.sync === 'enviando';
  return (
    <main className="pag-main" style={{ paddingTop: 40, alignItems: 'center' }}>
      <div className="pila-16 contenedor-form" style={{ gap: 20 }}>
        <div className="pila" style={{ alignItems: 'center', textAlign: 'center' }}>
          <span className="cuadro-ic" style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--ok-fondo)', color: 'var(--ok-texto)' }}>
            <CircleCheck style={{ width: 36, height: 36 }} />
          </span>
          <h1 className="t-title" style={{ fontSize: 24, lineHeight: '30px' }}>Venta registrada correctamente</h1>
          <p className="t-2 num">
            Venta {v.folio} · {formatoHora(venta.creadoEnDispositivo)}
          </p>
        </div>

        {(pendiente || state?.sinConexion) && (
          <AvisoLinea tono="info" icono={<CloudUpload className="ic" />}>
            Guardada en este dispositivo. Se enviará al recuperar conexión.
          </AvisoLinea>
        )}

        <dl className="card" style={{ padding: '4px 16px' }}>
          {venta.renglones.map((r, i) => (
            <div key={i} className="pila" style={{ gap: 0, borderBottom: '1px solid var(--gris-1)' }}>
              <div className="kv" style={{ borderBottom: 0, paddingBottom: 4 }}>
                <dt>Producto</dt>
                <dd>{r.productoNombre}</dd>
              </div>
              <div className="kv" style={{ borderBottom: 0, padding: '4px 0' }}>
                <dt>Clasificación</dt>
                <dd>{r.clasificacionNombre}</dd>
              </div>
              <div className="kv" style={{ borderBottom: 0, paddingTop: 4 }}>
                <dt>Cantidad</dt>
                <dd className="num">
                  {cantidadConUnidad(r.cantidad, { nombre: r.unidadNombre, plural: r.unidadPlural })} × {formatoMXN(r.precio)}
                </dd>
              </div>
            </div>
          ))}
          <div className="kv">
            <dt>Cliente</dt>
            <dd>
              {venta.formaPago === 'credito'
                ? `${venta.clienteNombre} · Crédito`
                : `${venta.clienteNombre ?? 'Contado'} · ${ETIQUETA_FORMA_PAGO[venta.formaPago]}`}
            </dd>
          </div>
          {venta.venceEl && (
            <div className="kv">
              <dt>Vence</dt>
              <dd className="num">{formatoDia(venta.venceEl)}</dd>
            </div>
          )}
          <div className="kv" style={{ fontSize: 18 }}>
            <dt>Total</dt>
            <dd className="num" style={{ fontSize: 22 }}>{formatoMXN(venta.total)}</dd>
          </div>
        </dl>

        <div className="pila">
          <Link className="btn btn-p btn-lg" to="/ventas/nueva" replace>
            <Plus className="ic" />
            Nueva venta
          </Link>
          <div className="rejilla-2">
            <Link className="btn btn-q" to={`/ventas/${venta.id}`} replace>
              Ver detalle
            </Link>
            <Link className="btn btn-q" to="/ventas" replace>
              Ir a ventas
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
