import { useLiveQuery } from 'dexie-react-hooks';
import { HandCoins, Pencil, Phone, Plus, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { AvisoLinea, EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Segmentado } from '../../componentes/Formulario';
import { InsigniaCliente, InsigniaDeuda, InsigniaSync } from '../../componentes/Insignias';
import { db } from '../../db/db';
import { cargarOperaciones, clientesVista, sincronizacionDe, ventasVista } from '../../dominio/consultas';
import { ETIQUETA_FORMA_PAGO, ETIQUETA_METODO, folioVenta } from '../../dominio/formato';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN } from '../../lib/dinero';
import { formatoDia, formatoMesAnio, formatoRelativo } from '../../lib/fechas';

/** Pantalla 21 · Detalle de cliente: saldo, deudas y movimientos. */
export default function DetalleCliente() {
  const { id } = useParams();
  const { puede } = useSesionActiva();
  const [pestana, setPestana] = useState<'movimientos' | 'deudas'>('movimientos');
  const datos = useLiveQuery(async () => {
    const c = (await clientesVista()).find((x) => x.cliente.id === id);
    if (!c) return null;
    const [ventas, pagos, { porId }] = await Promise.all([ventasVista(), db.pagos.where('clienteId').equals(id!).toArray(), cargarOperaciones()]);
    const movimientos = [
      ...ventas
        .filter((v) => v.venta.clienteId === id)
        .map((v) => ({
          id: v.venta.id,
          fecha: v.venta.creadoEnDispositivo,
          titulo: `Venta ${v.folio}${v.venta.formaPago === 'credito' ? ' · a crédito' : ''}`,
          detalle: v.venta.formaPago === 'credito' ? 'Crédito' : `Contado · ${ETIQUETA_FORMA_PAGO[v.venta.formaPago]}`,
          monto: formatoMXN(v.venta.total),
          ruta: `/ventas/${v.venta.id}`,
          sync: v.sync,
          cancelada: v.estado === 'cancelada',
        })),
      ...pagos
        .filter((p) => sincronizacionDe(porId, p.operacionId) !== 'rechazada')
        .map((p) => ({
          id: p.id,
          fecha: p.creadoEnDispositivo,
          titulo: p.aplicaciones.length === 1 ? `Pago a deuda ${folioVenta(ventas.find((v) => v.venta.id === p.aplicaciones[0].ventaId)?.venta ?? { folio: null, folioProvisional: null })}` : 'Pago de deudas',
          detalle: ETIQUETA_METODO[p.metodo],
          monto: formatoMXN(p.monto),
          ruta: null as string | null,
          sync: sincronizacionDe(porId, p.operacionId),
          cancelada: false,
        })),
    ].sort((a, b) => b.fecha.localeCompare(a.fecha));
    return { c, movimientos };
  }, [id]);

  if (datos === undefined) {
    return (
      <>
        <EncabezadoSecundario titulo="Cliente" volverA="/clientes" />
        <main className="pag-main con-enc-sec"><Esqueleto filas={2} /></main>
      </>
    );
  }
  if (!datos) {
    return (
      <>
        <EncabezadoSecundario titulo="Cliente" volverA="/clientes" />
        <main className="pag-main con-enc-sec">
          <EstadoVacio titulo="No encontramos al cliente" texto="Puede que su alta haya sido rechazada al sincronizar." acciones={<Link className="btn btn-q" to="/clientes">Ir a clientes</Link>} />
        </main>
      </>
    );
  }
  const { c, movimientos } = datos;
  const vencida = c.deudasAbiertas.find((d) => d.deuda === 'vencida');
  return (
    <>
      <EncabezadoSecundario
        titulo={c.cliente.nombre}
        subtitulo={`Cliente desde ${formatoMesAnio(c.cliente.creadoEn)}`}
        volverA="/clientes"
        conSync={false}
        acciones={
          puede('clientes.editar') && (
            <Link className="icon-btn" to={`/clientes/${c.cliente.id}/editar`} aria-label="Editar cliente">
              <Pencil className="ic" />
            </Link>
          )
        }
      />
      <main className="pag-main con-enc-sec">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto' }}>
          {(c.sync === 'en_revision' || c.cliente.requiereRevision) && (
            <AvisoLinea tono="warn" icono={<TriangleAlert className="ic" />}>
              <strong>En revisión</strong>
              Puede ser un cliente duplicado; un administrador lo revisará.
            </AvisoLinea>
          )}
          <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="fila-entre" style={{ alignItems: 'flex-start' }}>
              <div>
                <p className="t-2">Saldo pendiente</p>
                <p className="num" style={{ fontSize: 32, lineHeight: '38px', fontWeight: 700 }}>
                  {formatoMXN(c.saldo)}
                </p>
              </div>
              <div className="pila" style={{ alignItems: 'flex-end', gap: 6 }}>
                <InsigniaCliente estado={c.estado} />
                <InsigniaSync estado={c.sync} />
              </div>
            </div>
            {c.deudasAbiertas.length > 0 && (
              <p className="t-2 num" style={{ color: vencida ? 'var(--error-texto)' : undefined, fontWeight: 600 }}>
                {c.deudasAbiertas.length} {c.deudasAbiertas.length === 1 ? 'deuda' : 'deudas'}
                {vencida?.venta.venceEl && ` · venció el ${formatoDia(vencida.venta.venceEl)}`}
              </p>
            )}
            {D(c.cliente.saldoAFavor).gt(0) && <p className="t-2">Saldo a favor: {formatoMXN(c.cliente.saldoAFavor)} (en revisión)</p>}
            <div className="rejilla-2">
              {puede('pagos.registrar') && c.saldo.gt(0) ? (
                <Link className="btn btn-s" to={`/cobrar?cliente=${c.cliente.id}`}>
                  <HandCoins className="ic" />
                  Registrar pago
                </Link>
              ) : (
                <span />
              )}
              {puede('ventas.crear') && (
                <Link className="btn btn-p" to="/ventas/nueva">
                  <Plus className="ic" />
                  Nueva venta
                </Link>
              )}
            </div>
          </section>

          <dl className="card" style={{ padding: '4px 16px' }}>
            <div className="kv">
              <dt>Teléfono</dt>
              <dd>
                {c.cliente.telefono ? (
                  <a href={`tel:${c.cliente.telefono.replace(/\s/g, '')}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <Phone className="ic" style={{ width: 16, height: 16 }} />
                    {c.cliente.telefono}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div className="kv">
              <dt>Negocio</dt>
              <dd>{c.cliente.ubicacion ?? '—'}</dd>
            </div>
            {c.cliente.plazoDias && (
              <div className="kv">
                <dt>Plazo de crédito</dt>
                <dd>{c.cliente.plazoDias} días</dd>
              </div>
            )}
          </dl>

          <Segmentado
            etiqueta="Ver"
            valor={pestana}
            alCambiar={setPestana}
            opciones={[
              { valor: 'movimientos', texto: 'Movimientos' },
              { valor: 'deudas', texto: `Deudas (${c.deudasAbiertas.length})` },
            ]}
          />

          <div className="card" style={{ overflow: 'hidden' }}>
            {pestana === 'movimientos'
              ? movimientos.map((m) => {
                  const cuerpo = (
                    <>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 600, fontSize: 15, textDecoration: m.cancelada ? 'line-through' : undefined }}>{m.titulo}</p>
                        <p className="t-aux">
                          {formatoRelativo(m.fecha)} · {m.detalle}
                        </p>
                        <InsigniaSync estado={m.sync} />
                      </div>
                      <p className="num" style={{ fontWeight: 700 }}>
                        {m.monto}
                      </p>
                    </>
                  );
                  return m.ruta ? (
                    <Link key={m.id} className="rowlink" to={m.ruta}>
                      {cuerpo}
                    </Link>
                  ) : (
                    <div key={m.id} className="rowlink" style={{ cursor: 'default' }}>
                      {cuerpo}
                    </div>
                  );
                })
              : c.deudasAbiertas.map((d) => (
                  <Link key={d.venta.id} className="rowlink" to={`/deudas/${d.venta.id}`}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, fontSize: 15 }}>Venta {d.folio}</p>
                      <p className="t-aux num">{d.venta.venceEl ? `Vence ${formatoDia(d.venta.venceEl)}` : 'Sin vencimiento'}</p>
                    </div>
                    <div className="pila" style={{ alignItems: 'flex-end', gap: 4 }}>
                      <p className="num" style={{ fontWeight: 700 }}>{formatoMXN(d.saldo)}</p>
                      {d.deuda && <InsigniaDeuda estado={d.deuda} />}
                    </div>
                  </Link>
                ))}
            {pestana === 'movimientos' && movimientos.length === 0 && <p className="t-2" style={{ padding: 14 }}>Sin movimientos.</p>}
            {pestana === 'deudas' && c.deudasAbiertas.length === 0 && <p className="t-2" style={{ padding: 14 }}>No tiene deudas abiertas.</p>}
          </div>
        </div>
      </main>
    </>
  );
}
