import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, LockKeyhole, Plus, ShoppingCart } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Buscador, Chips } from '../../componentes/Formulario';
import { InsigniaSync } from '../../componentes/Insignias';
import { BannerSinConexion } from '../../componentes/Sincronizacion';
import { HojaInferior } from '../../componentes/Superpuestos';
import { db } from '../../db/db';
import { filtrarOrdenarCompras, resumenCompras, type CompraVistaLista, type EstadoCompras, type OrdenCompras, type PeriodoCompras } from '../../dominio/compras';
import { cargarOperaciones, sincronizacionDe } from '../../dominio/consultas';
import { cantidadConUnidad, folioCompra } from '../../dominio/formato';
import { useFormato } from '../../hooks/useFormato';
import { EncabezadoPagina, EncabezadoSecundario } from '../../layout/Encabezados';
import { formatoMXN } from '../../lib/dinero';
import { diaLocal, formatoDia, formatoHora, formatoRelativo, textoDias } from '../../lib/fechas';
import './compras.css';

function DetalleCompra({ compra: { c, sync }, alCerrar }: { compra: CompraVistaLista; alCerrar: () => void }) {
  const vencida = c.formaPago === 'credito' && !!c.venceEl && c.venceEl < diaLocal();
  return (
    <HojaInferior titulo={`Compra ${folioCompra(c)}`} subtitulo={`${formatoDia(diaLocal(c.creadoEnDispositivo))} · ${formatoHora(c.creadoEnDispositivo)}`} alCerrar={alCerrar}>
      <div className="compra-modal-lectura" role="note">
        <LockKeyhole className="ic" />
        <span>Consulta de solo lectura. Una compra registrada ya no puede editarse.</span>
      </div>

      <dl className="compra-modal-datos">
        <div><dt>Proveedor · quién vendió</dt><dd>{c.proveedorNombre}</dd></div>
        <div><dt>Registró la compra</dt><dd>{c.usuarioNombre}</dd></div>
        <div><dt>Forma de pago</dt><dd>{c.formaPago === 'contado' ? 'Contado' : 'Crédito'}</dd></div>
        <div><dt>Estado</dt><dd>{vencida ? 'Crédito vencido' : c.formaPago === 'credito' ? 'Crédito vigente' : 'Pagada de contado'}</dd></div>
        {c.formaPago === 'credito' && c.venceEl && <div><dt>Fecha de vencimiento</dt><dd>{formatoDia(c.venceEl)} · {textoDias(c.venceEl)}</dd></div>}
        <div><dt>Sincronización</dt><dd><InsigniaSync estado={sync} /></dd></div>
      </dl>

      <section className="compra-modal-mercancia" aria-labelledby="compra-modal-partidas">
        <div className="fila-entre">
          <h3 id="compra-modal-partidas" className="t-sec">Mercancía comprada</h3>
          <span className="t-aux">{c.renglones.length} {c.renglones.length === 1 ? 'partida' : 'partidas'}</span>
        </div>
        <div className="compra-modal-renglones">
          {c.renglones.map((r, i) => (
            <div className="compra-renglon" key={`${r.clasificacionId}-${i}`}>
              <p>{r.productoNombre} · {r.clasificacionNombre}</p>
              <small>{cantidadConUnidad(r.cantidad, { nombre: r.unidadNombre, plural: r.unidadPlural })} × {formatoMXN(r.costo)}</small>
              <strong className="num">{formatoMXN(r.importe)}</strong>
            </div>
          ))}
        </div>
        <div className="compra-modal-total"><span>Total de la compra</span><strong className="num">{formatoMXN(c.total)}</strong></div>
      </section>

      <button type="button" className="btn btn-q" onClick={alCerrar}>Cerrar detalle</button>
    </HojaInferior>
  );
}

/** Historial de compras con resumen, filtros y desglose de mercancía. */
export default function Compras() {
  const { puede } = useSesionActiva();
  const formato = useFormato();
  const [q, setQ] = useState('');
  const [periodo, setPeriodo] = useState<PeriodoCompras>('hoy');
  const [estado, setEstado] = useState<EstadoCompras>('todas');
  const [orden, setOrden] = useState<OrdenCompras>('recientes');
  const [compraAbierta, setCompraAbierta] = useState<CompraVistaLista | null>(null);
  const compras = useLiveQuery(async () => {
    const [lista, { porId }] = await Promise.all([db.compras.orderBy('creadoEnDispositivo').reverse().toArray(), cargarOperaciones()]);
    return lista.map((c) => ({ c, sync: sincronizacionDe(porId, c.operacionId) })).filter((x) => x.sync !== 'rechazada');
  });

  const todas = useMemo(() => compras ?? [], [compras]);
  const resumen = useMemo(() => resumenCompras(todas), [todas]);
  const lista = useMemo(() => filtrarOrdenarCompras(todas, q, periodo, estado, orden), [todas, q, periodo, estado, orden]);
  const cuentas = useMemo(() => ({
    contado: todas.filter(({ c }) => c.formaPago === 'contado').length,
    credito: todas.filter(({ c }) => c.formaPago === 'credito').length,
    vencidas: todas.filter(({ c }) => c.formaPago === 'credito' && !!c.venceEl && c.venceEl < diaLocal()).length,
  }), [todas]);
  const nueva = puede('compras.crear') && (
    <Link className="btn btn-p" to="/compras/nueva"><Plus className="ic" />Nueva compra</Link>
  );

  return (
    <>
      {formato === 'telefono'
        ? <EncabezadoSecundario titulo="Compras" subtitulo={`${todas.length} registradas`} volverA="/mas" />
        : <EncabezadoPagina titulo="Compras" subtitulo="Entradas de mercancía y costos de proveedores" acciones={nueva} />}
      <main className={`pag-main${formato === 'telefono' ? ' con-enc-sec con-barra' : ''}`}>
        <div className="pila-16 compras-contenido">
          <BannerSinConexion />

          {compras && todas.length > 0 && (
            <section className="compras-resumen" aria-label="Resumen de compras">
              <div className="card compra-kpi"><span>Compras de hoy</span><strong className="num">{formatoMXN(resumen.totalHoy)}</strong><small>{resumen.hoy} operaciones</small></div>
              <div className="card compra-kpi"><span>Últimos 7 días</span><strong className="num">{formatoMXN(resumen.totalSemana)}</strong><small>{resumen.semana} operaciones</small></div>
              <div className="card compra-kpi"><span>Registrado a crédito</span><strong className="num">{formatoMXN(resumen.totalCredito)}</strong><small>{resumen.credito} compras</small></div>
              <div className={`card compra-kpi${resumen.vencidas ? ' alerta' : ''}`}><span>Créditos vencidos</span><strong className="num">{formatoMXN(resumen.totalVencido)}</strong><small>{resumen.vencidas} compras</small></div>
            </section>
          )}

          <div className="compras-controles">
            <Buscador valor={q} alCambiar={setQ} etiqueta="Buscar compra" marcador="Folio, proveedor, producto o usuario" />
            <div className="compras-orden">
              <label htmlFor="orden-compras">Ordenar por</label>
              <select id="orden-compras" className="inp" value={orden} onChange={(e) => setOrden(e.target.value as OrdenCompras)}>
                <option value="recientes">Más recientes</option>
                <option value="monto">Mayor monto</option>
                <option value="proveedor">Proveedor</option>
              </select>
            </div>
          </div>

          <Chips<PeriodoCompras>
            etiqueta="Periodo"
            valor={periodo}
            alCambiar={setPeriodo}
            opciones={[
              { valor: 'hoy', texto: 'Hoy' },
              { valor: 'semana', texto: '7 días' },
              { valor: 'mes', texto: '30 días' },
              { valor: 'todas', texto: 'Todo el historial' },
            ]}
          />
          <Chips<EstadoCompras>
            etiqueta="Forma de pago"
            valor={estado}
            alCambiar={setEstado}
            opciones={[
              { valor: 'todas', texto: 'Todas' },
              { valor: 'contado', texto: 'Contado', cuenta: cuentas.contado },
              { valor: 'credito', texto: 'Crédito', cuenta: cuentas.credito },
              { valor: 'vencidas', texto: 'Vencidas', cuenta: cuentas.vencidas },
            ]}
          />

          {!compras ? (
            <Esqueleto />
          ) : todas.length === 0 ? (
            <EstadoVacio icono={ShoppingCart} titulo="Aún no hay compras" texto="Registra la mercancía que recibes para actualizar existencias y costos." acciones={nueva} />
          ) : lista.length === 0 ? (
            <EstadoVacio
              icono={ShoppingCart}
              titulo="No encontramos compras"
              texto="Prueba con otro periodo, forma de pago o búsqueda."
              acciones={<button type="button" className="btn btn-q" onClick={() => { setQ(''); setPeriodo('todas'); setEstado('todas'); }}>Limpiar filtros</button>}
            />
          ) : (
            <>
              <p className="t-aux" aria-live="polite">Mostrando {lista.length} de {todas.length} compras</p>
              <section className="compras-lista" aria-label="Compras">
                {lista.map(({ c, sync }) => {
                  const vencida = c.formaPago === 'credito' && !!c.venceEl && c.venceEl < diaLocal();
                  const productos = c.renglones.map((r) => r.productoNombre).filter((nombre, i, arreglo) => arreglo.indexOf(nombre) === i);
                  return (
                    <article key={c.id} className="card compra-card">
                      <div className="compra-card-cabecera">
                        <div className="compra-card-superior">
                          <div>
                            <p className="t-aux num">Compra {folioCompra(c)} · {diaLocal(c.creadoEnDispositivo) === diaLocal() ? formatoHora(c.creadoEnDispositivo) : formatoRelativo(c.creadoEnDispositivo)}</p>
                            <h2 className="compra-card-proveedor">{c.proveedorNombre}</h2>
                          </div>
                          <p className="num compra-card-total">{formatoMXN(c.total)}</p>
                        </div>
                        <p className="compra-card-productos"><strong>{c.renglones.length} {c.renglones.length === 1 ? 'partida' : 'partidas'}:</strong> {productos.join(', ')}</p>
                        <div className="compra-card-insignias">
                          <span className="bdg b-ok">Registrada</span>
                          {c.formaPago === 'contado' && <span className="bdg b-neu">Contado</span>}
                          {c.formaPago === 'credito' && <span className={`bdg ${vencida ? 'b-errt' : 'b-warn'}`}>{vencida ? 'Crédito vencido' : 'A crédito'}{c.venceEl ? ` · ${textoDias(c.venceEl)}` : ''}</span>}
                          <InsigniaSync estado={sync} />
                        </div>
                      </div>
                      <div className="compra-card-acciones">
                        <button type="button" className="btn btn-q" onClick={() => setCompraAbierta({ c, sync })}>
                          <Eye className="ic" />Ver detalles
                        </button>
                      </div>
                    </article>
                  );
                })}
              </section>
            </>
          )}
        </div>
      </main>
      {formato === 'telefono' && puede('compras.crear') && (
        <div className="barra-accion"><Link className="btn btn-p btn-lg" style={{ flex: 1 }} to="/compras/nueva"><Plus className="ic" />Nueva compra</Link></div>
      )}
      {compraAbierta && <DetalleCompra compra={compraAbierta} alCerrar={() => setCompraAbierta(null)} />}
    </>
  );
}
