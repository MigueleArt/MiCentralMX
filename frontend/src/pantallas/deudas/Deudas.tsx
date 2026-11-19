import { useLiveQuery } from 'dexie-react-hooks';
import {
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  HandCoins,
  Phone,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { AvisoLinea, EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Buscador, Chips, Segmentado, coincide } from '../../componentes/Formulario';
import { InsigniaDeuda, InsigniaSync } from '../../componentes/Insignias';
import { BannerSinConexion } from '../../componentes/Sincronizacion';
import { HojaInferior } from '../../componentes/Superpuestos';
import { db, type PagoLocal } from '../../db/db';
import type { Pago } from '@micentralmx/shared/entidades';
import { cargarOperaciones, sincronizacionDe, type VentaVista } from '../../dominio/consultas';
import { ETIQUETA_METODO } from '../../dominio/formato';
import {
  agruparDeudasPorCliente,
  resumenAbonos,
  resumenDeudas,
  type DeudaClienteResumen,
} from '../../dominio/resumenes';
import { useClientes, useDeudas } from '../../hooks/useDatosLocales';
import { useFormato } from '../../hooks/useFormato';
import { EncabezadoPagina } from '../../layout/Encabezados';
import { D, formatoMXN } from '../../lib/dinero';
import { formatoDia, formatoRelativo, textoDias } from '../../lib/fechas';
import { iniciales } from '../../lib/ids';
import {
  copiarAlPortapapeles,
  textoComprobanteAbono,
  textoEstadoCuentaCliente,
} from './comprobantes';
import { PanelDeuda } from './DetalleDeuda';
import { RegistrarPago } from './RegistrarPago';
import './deudas.css';

type VistaDeudas = 'cliente' | 'venta';
type FiltroCliente = 'todos' | 'vencida' | 'proxima' | 'pendiente';
type FiltroVenta = 'todas' | 'atencion' | 'proximas' | 'pendientes' | 'pagadas';
type Orden = 'vencimiento' | 'saldo';

const venceTexto = (d: VentaVista) =>
  d.venta.venceEl ? `${d.deuda === 'vencida' ? 'Venció' : 'Vence'} ${formatoDia(d.venta.venceEl)}` : 'Sin vencimiento';

function Kpis({
  r,
  abonos,
  formato,
}: {
  r: ReturnType<typeof resumenDeudas>;
  abonos: ReturnType<typeof resumenAbonos>;
  formato: string;
}) {
  const pc = formato === 'pc';
  const caja = (etiqueta: string, valor: string, detalle: string, color: string, icono?: React.ReactNode) => (
    <div className="card kpi">
      <p className="t-aux" style={{ display: 'flex', gap: 4, alignItems: 'center', color, fontWeight: 600 }}>
        {icono}
        {etiqueta}
      </p>
      <p className="valor num">{valor}</p>
      {pc && <p className="t-aux">{detalle}</p>}
    </div>
  );
  const ic = { width: 14, height: 14 };
  return (
    <div className="rejilla-4">
      {caja(pc ? 'Total por cobrar' : 'Por cobrar', formatoMXN(r.porCobrar), `${r.clientes} clientes`, 'var(--texto-2)')}
      {caja('Vencidas', formatoMXN(r.totalVencido), `${r.vencidas.length} deudas · requieren atención`, 'var(--error-texto)', <CircleAlert style={ic} />)}
      {caja(pc ? 'Próximas a vencer' : 'Próximas', formatoMXN(r.totalProximo), `${r.proximas.length} deudas · próximos 7 días`, 'var(--aviso-texto)', <Clock style={ic} />)}
      {caja('Abonado hoy', formatoMXN(abonos.abonadoHoy), `Este mes: ${formatoMXN(abonos.abonadoMes)}`, 'var(--ok-texto)', <CircleCheck style={ic} />)}
    </div>
  );
}

function PanelClienteDeuda({
  c,
  pagos,
  negocioNombre,
  puedeCobrar,
  alAbonar,
  alCerrar,
}: {
  c: DeudaClienteResumen;
  pagos: PagoLocal[];
  negocioNombre: string;
  puedeCobrar: boolean;
  alAbonar: (ventaId: string | null, saldo: string) => void;
  alCerrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const pct = c.totalOriginal.gt(0) ? Math.min(100, c.totalAbonado.div(c.totalOriginal).times(100).toNumber()) : 0;
  const abonosCliente = pagos.filter((p) => p.clienteId === c.clienteId).slice(0, 4);

  const copiarEstado = async () => {
    const ok = await copiarAlPortapapeles(
      textoEstadoCuentaCliente({
        negocio: negocioNombre,
        clienteNombre: c.clienteNombre,
        saldoTotal: c.saldoTotal,
        deudasAbiertas: c.deudasAbiertas,
      }),
    );
    if (ok) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    }
  };

  return (
    <aside className="card" aria-label="Estado de cuenta del cliente" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', alignSelf: 'flex-start' }}>
      <div className="fila-entre" style={{ padding: '18px 20px', borderBottom: '1px solid var(--gris-1)', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h2 className="t-sec">{c.clienteNombre}</h2>
          <p className="t-2">
            {c.cantidadDeudas} {c.cantidadDeudas === 1 ? 'nota abierta' : 'notas abiertas'}
            {c.ubicacion ? ` · ${c.ubicacion}` : ''}
          </p>
          {c.telefono && (
            <a href={`tel:${c.telefono.replace(/\s/g, '')}`} className="t-aux" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <Phone className="ic" style={{ width: 14, height: 14 }} />
              {c.telefono}
            </a>
          )}
        </div>
        <button type="button" className="icon-btn" aria-label="Cerrar detalle" onClick={alCerrar}>
          <X className="ic" />
        </button>
      </div>

      <div className="pila-16" style={{ padding: '16px 20px' }}>
        <div className="fila-entre" style={{ alignItems: 'flex-start' }}>
          <div>
            <p className="t-2">Saldo total pendiente</p>
            <p className="num" style={{ fontSize: 30, lineHeight: '36px', fontWeight: 700 }}>
              {formatoMXN(c.saldoTotal)}
            </p>
          </div>
          <InsigniaDeuda estado={c.estado} />
        </div>

        <div className="pila" style={{ gap: 6 }}>
          <div className="bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="t-2 num fila-entre">
            <span>
              Abonado <strong style={{ color: 'var(--texto)' }}>{formatoMXN(c.totalAbonado)}</strong>
            </span>
            <span>
              Original <strong style={{ color: 'var(--texto)' }}>{formatoMXN(c.totalOriginal)}</strong>
            </span>
          </div>
        </div>

        <div className="deudas-panel-acciones">
          {puedeCobrar && (
            <button type="button" className="btn btn-p btn-sm" style={{ flex: 1 }} onClick={() => alAbonar(null, c.saldoTotal.toString())}>
              <HandCoins className="ic" />
              Registrar abono
            </button>
          )}
          <button type="button" className="btn btn-q btn-sm" onClick={() => void copiarEstado()}>
            <Copy className="ic" />
            {copiado ? 'Copiado' : 'Copiar estado'}
          </button>
          <Link className="btn btn-g btn-sm" to={`/clientes/${c.clienteId}`}>
            <UserRound className="ic" />
            Ver perfil
          </Link>
        </div>

        <section className="pila">
          <h3 className="lbl">Notas pendientes</h3>
          <div>
            {c.deudasAbiertas.map((d) => (
              <div key={d.venta.id} className="deudas-nota-fila">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="fila" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <Link to={`/deudas/${d.venta.id}`} style={{ fontWeight: 600 }}>
                      Venta {d.folio}
                    </Link>
                    {d.deuda && <InsigniaDeuda estado={d.deuda} />}
                  </div>
                  <p className="t-aux num">
                    {venceTexto(d)}
                    {d.venta.venceEl ? ` · ${textoDias(d.venta.venceEl)}` : ''}
                  </p>
                </div>
                <div className="fila">
                  <p className="num" style={{ fontWeight: 700 }}>{formatoMXN(d.saldo)}</p>
                  {puedeCobrar && (
                    <button
                      type="button"
                      className="btn btn-s btn-sm"
                      onClick={() => alAbonar(d.venta.id, d.saldo.toString())}
                    >
                      Abonar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="pila">
          <h3 className="lbl">Últimos abonos del cliente</h3>
          {abonosCliente.length === 0 ? (
            <p className="t-2">Todavía no registra abonos.</p>
          ) : (
            <div className="pila">
              {abonosCliente.map((p) => (
                <div key={p.id} className="fila-entre" style={{ padding: '6px 0', borderBottom: '1px solid var(--gris-1)' }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>{ETIQUETA_METODO[p.metodo]}</p>
                    <p className="t-aux num">
                      {formatoRelativo(p.creadoEnDispositivo)}
                      {p.nota ? ` · “${p.nota}”` : ''}
                    </p>
                  </div>
                  <p className="num deudas-abono-monto">+{formatoMXN(p.monto)}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

/** Pantalla 10 (Deudas), Deudas · Tablet 768 y Deudas · PC 1440, con vista libreta por cliente y registro rápido de abonos. */
export default function Deudas() {
  const { sesion, puede } = useSesionActiva();
  const formato = useFormato();
  const deudas = useDeudas();
  const clientes = useClientes();
  const pagosInfo = useLiveQuery(async () => {
    const [pagos, { porId }] = await Promise.all([db.pagos.toArray(), cargarOperaciones()]);
    const rechazadas = new Set(
      [...porId.values()].filter((o) => o.estado === 'rechazada').map((o) => o.operacionId),
    );
    return { pagos, rechazadas, porId };
  });

  const [params, setParams] = useSearchParams();
  const [vista, setVista] = useState<VistaDeudas>('cliente');
  const [q, setQ] = useState('');
  const [filtroCliente, setFiltroCliente] = useState<FiltroCliente>('todos');
  const [filtroVenta, setFiltroVenta] = useState<FiltroVenta>('todas');
  const [orden, setOrden] = useState<Orden>('vencimiento');
  const [hojaOrden, setHojaOrden] = useState(false);
  const [abonoModal, setAbonoModal] = useState<{
    clienteId: string;
    clienteNombre: string;
    ventaId: string | null;
    saldo: string;
  } | null>(null);
  const [ultimoAbono, setUltimoAbono] = useState<{
    pago: Pago;
    saldoAnterior: string;
    saldoRestante: string;
  } | null>(null);
  const [comprobanteCopiado, setComprobanteCopiado] = useState(false);

  const seleccionVenta = params.get('sel');
  const seleccionCliente = params.get('cli');
  const elegirVenta = (id: string | null) => setParams(id ? { sel: id } : {}, { replace: true });
  const elegirCliente = (id: string | null) => setParams(id ? { cli: id } : {}, { replace: true });

  if (!deudas || !clientes || !pagosInfo) {
    return (
      <>
        <EncabezadoPagina titulo="Deudas" />
        <main className="pag-main"><Esqueleto texto="Cargando deudas…" /></main>
      </>
    );
  }

  const r = resumenDeudas(deudas);
  const pagosValidos = [...pagosInfo.pagos]
    .filter((p) => !(p.operacionId && pagosInfo.rechazadas.has(p.operacionId)))
    .sort((a, b) => b.creadoEnDispositivo.localeCompare(a.creadoEnDispositivo));
  const abonos = resumenAbonos(pagosValidos);
  const clientesDeuda = agruparDeudasPorCliente(deudas, clientes, pagosValidos);

  const ancho = formato !== 'telefono';
  const puedeCobrar = puede('pagos.registrar');

  // Filtrado por cliente
  const buscaCliente = (c: DeudaClienteResumen) =>
    !q.trim() || coincide(`${c.clienteNombre} ${c.telefono ?? ''} ${c.deudasAbiertas.map((d) => d.folio).join(' ')}`, q);
  const listaClientes = [...clientesDeuda]
    .filter((c) => (filtroCliente === 'todos' || c.estado === filtroCliente) && buscaCliente(c))
    .sort((a, b) =>
      orden === 'saldo'
        ? b.saldoTotal.comparedTo(a.saldoTotal)
        : (a.proximoVencimiento ?? '9999').localeCompare(b.proximoVencimiento ?? '9999') ||
          b.saldoTotal.comparedTo(a.saldoTotal),
    );
  const clienteSeleccionadoId = seleccionCliente ?? (ancho ? listaClientes[0]?.clienteId : undefined);
  const clienteSeleccionado = listaClientes.find((c) => c.clienteId === clienteSeleccionadoId);

  // Filtrado por venta
  const buscaVenta = (d: VentaVista) =>
    !q.trim() || coincide(`${d.venta.clienteNombre} ${d.folio} ${d.venta.venceEl ? formatoDia(d.venta.venceEl) : ''}`, q);
  const ordenarVentas = (l: VentaVista[]) =>
    [...l].sort((a, b) => (orden === 'saldo' ? b.saldo.comparedTo(a.saldo) : (a.venta.venceEl ?? '9').localeCompare(b.venta.venceEl ?? '9')));
  const gruposVenta: Record<FiltroVenta, VentaVista[]> = {
    todas: [...r.vencidas, ...r.proximas, ...r.pendientes],
    atencion: r.vencidas,
    proximas: r.proximas,
    pendientes: r.pendientes,
    pagadas: r.pagadasMes,
  };
  const listaVentas = ordenarVentas(gruposVenta[filtroVenta].filter(buscaVenta));
  const ventaSeleccionada = seleccionVenta ?? (ancho ? listaVentas[0]?.venta.id : undefined);

  const copiarComprobante = async () => {
    if (!ultimoAbono) return;
    const ok = await copiarAlPortapapeles(
      textoComprobanteAbono({
        negocio: sesion.negocio.nombre,
        clienteNombre: ultimoAbono.pago.clienteNombre,
        monto: ultimoAbono.pago.monto,
        metodo: ultimoAbono.pago.metodo,
        fecha: ultimoAbono.pago.creadoEnDispositivo,
        saldoAnterior: ultimoAbono.saldoAnterior,
        saldoRestante: ultimoAbono.saldoRestante,
        nota: ultimoAbono.pago.nota,
      }),
    );
    if (ok) {
      setComprobanteCopiado(true);
      setTimeout(() => setComprobanteCopiado(false), 2000);
    }
  };

  const abrirAbono = (clienteId: string, clienteNombre: string, ventaId: string | null, saldo: string) => {
    setAbonoModal({ clienteId, clienteNombre, ventaId, saldo });
  };

  const chipsCliente = (
    <Chips<FiltroCliente>
      etiqueta="Filtrar clientes con deuda"
      valor={filtroCliente}
      alCambiar={setFiltroCliente}
      opciones={[
        { valor: 'todos', texto: 'Todos', cuenta: clientesDeuda.length },
        {
          valor: 'vencida',
          texto: 'Con vencidas',
          cuenta: clientesDeuda.filter((c) => c.estado === 'vencida').length,
          icono: <CircleAlert className="ic" style={{ width: 16, height: 16 }} />,
        },
        { valor: 'proxima', texto: 'Próximas', cuenta: clientesDeuda.filter((c) => c.estado === 'proxima').length },
        { valor: 'pendiente', texto: 'Al corriente', cuenta: clientesDeuda.filter((c) => c.estado === 'pendiente').length },
      ]}
    />
  );

  const chipsVenta = (
    <Chips<FiltroVenta>
      etiqueta="Filtrar deudas por venta"
      valor={filtroVenta}
      alCambiar={setFiltroVenta}
      opciones={[
        { valor: 'todas', texto: 'Todas', cuenta: r.vencidas.length + r.proximas.length + r.pendientes.length },
        {
          valor: 'atencion',
          texto: 'Requiere atención',
          cuenta: r.vencidas.length,
          icono: <CircleAlert className="ic" style={{ width: 16, height: 16 }} />,
        },
        { valor: 'proximas', texto: 'Próximas', cuenta: r.proximas.length },
        { valor: 'pendientes', texto: 'Pendientes', cuenta: r.pendientes.length },
        { valor: 'pagadas', texto: 'Pagadas' },
      ]}
    />
  );

  let contenido;
  if (vista === 'cliente') {
    if (listaClientes.length === 0) {
      contenido =
        clientesDeuda.length === 0 ? (
          <EstadoVacio icono={HandCoins} titulo="No hay deudas abiertas" texto="Las ventas a crédito con saldo pendiente aparecerán aquí agrupadas por cliente." />
        ) : (
          <EstadoVacio
            titulo="Sin coincidencias"
            texto={q ? `No hay clientes con saldo que coincidan con “${q}”.` : 'No hay clientes en este filtro.'}
            acciones={
              q ? (
                <button type="button" className="btn btn-q" onClick={() => setQ('')}>
                  Limpiar búsqueda
                </button>
              ) : undefined
            }
          />
        );
    } else if (formato === 'telefono') {
      contenido = (
        <section className="pila" aria-label="Clientes con saldo">
          {listaClientes.map((c) => (
            <article key={c.clienteId} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="fila-entre" style={{ alignItems: 'flex-start' }}>
                <div className="fila" style={{ minWidth: 0 }}>
                  <span className="avatar">{iniciales(c.clienteNombre)}</span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 16, fontWeight: 600 }}>{c.clienteNombre}</p>
                    <p className="t-aux num">
                      {c.cantidadDeudas} {c.cantidadDeudas === 1 ? 'nota abierta' : 'notas abiertas'}
                      {c.ultimoAbono ? ` · Últ. abono ${formatoRelativo(c.ultimoAbono.fecha)}` : ''}
                    </p>
                  </div>
                </div>
                <InsigniaDeuda estado={c.estado} />
              </div>

              <div className="fila-entre" style={{ alignItems: 'flex-end' }}>
                <div>
                  <p className="t-aux">Saldo total</p>
                  <p className="num" style={{ fontSize: 22, fontWeight: 700, lineHeight: '28px' }}>
                    {formatoMXN(c.saldoTotal)}
                  </p>
                </div>
                {c.proximoVencimiento && (
                  <p className="t-aux num" style={{ textAlign: 'right', color: c.estado === 'vencida' ? 'var(--error-texto)' : undefined, fontWeight: 600 }}>
                    {c.estado === 'vencida' ? 'Venció' : 'Vence'} {formatoDia(c.proximoVencimiento)}
                    <br />
                    {textoDias(c.proximoVencimiento)}
                  </p>
                )}
              </div>

              <div className="fila">
                {puedeCobrar && (
                  <button
                    type="button"
                    className="btn btn-s btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => abrirAbono(c.clienteId, c.clienteNombre, null, c.saldoTotal.toString())}
                  >
                    <HandCoins className="ic" />
                    Abonar
                  </button>
                )}
                <Link className="btn btn-g btn-sm" to={`/clientes/${c.clienteId}`}>
                  Ver cuenta
                </Link>
              </div>
            </article>
          ))}
        </section>
      );
    } else if (formato === 'tablet') {
      contenido = (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <section className="card" aria-label="Clientes con deuda" style={{ width: 300, flex: 'none', overflow: 'hidden' }}>
            {listaClientes.map((c) => (
              <button
                key={c.clienteId}
                type="button"
                className="rowlink"
                aria-current={c.clienteId === clienteSeleccionadoId || undefined}
                onClick={() => elegirCliente(c.clienteId)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: 15 }}>{c.clienteNombre}</p>
                  <p className="t-aux num">
                    {c.cantidadDeudas} {c.cantidadDeudas === 1 ? 'nota' : 'notas'}
                    {c.proximoVencimiento ? ` · ${formatoDia(c.proximoVencimiento)}` : ''}
                  </p>
                </div>
                <div className="pila" style={{ alignItems: 'flex-end', gap: 4 }}>
                  <p className="num" style={{ fontWeight: 700 }}>{formatoMXN(c.saldoTotal)}</p>
                  <InsigniaDeuda estado={c.estado} />
                </div>
              </button>
            ))}
          </section>
          {clienteSeleccionado && (
            <PanelClienteDeuda
              c={clienteSeleccionado}
              pagos={pagosValidos}
              negocioNombre={sesion.negocio.nombre}
              puedeCobrar={puedeCobrar}
              alAbonar={(vId, saldoObj) => abrirAbono(clienteSeleccionado.clienteId, clienteSeleccionado.clienteNombre, vId, saldoObj)}
              alCerrar={() => elegirCliente(null)}
            />
          )}
        </div>
      );
    } else {
      contenido = (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <div className="card tabla-card" style={{ flex: 1, minWidth: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Notas y estado</th>
                  <th>Último abono</th>
                  <th className="r">Saldo total</th>
                  <th className="r">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {listaClientes.map((c) => (
                  <tr key={c.clienteId} className={c.clienteId === clienteSeleccionadoId ? 'sel' : undefined}>
                    <td>
                      <p style={{ fontWeight: 600 }}>{c.clienteNombre}</p>
                      <p className="t-aux">{c.telefono ?? 'Sin teléfono'}</p>
                    </td>
                    <td>
                      <div className="fila" style={{ flexWrap: 'wrap', gap: 6 }}>
                        <InsigniaDeuda estado={c.estado} />
                        <span className="t-2 num">
                          {c.cantidadDeudas} {c.cantidadDeudas === 1 ? 'nota' : 'notas'}
                          {c.proximoVencimiento ? ` · ${formatoDia(c.proximoVencimiento)}` : ''}
                        </span>
                      </div>
                    </td>
                    <td>
                      {c.ultimoAbono ? (
                        <div>
                          <p className="num" style={{ fontWeight: 600, color: 'var(--ok-texto)' }}>
                            {formatoMXN(c.ultimoAbono.monto)}
                          </p>
                          <p className="t-aux">{formatoRelativo(c.ultimoAbono.fecha)}</p>
                        </div>
                      ) : (
                        <span className="t-aux">Sin abonos</span>
                      )}
                    </td>
                    <td className="r num" style={{ fontWeight: 700 }}>
                      {formatoMXN(c.saldoTotal)}
                    </td>
                    <td className="r">
                      <div className="fila" style={{ justifyContent: 'flex-end' }}>
                        {puedeCobrar && (
                          <button
                            type="button"
                            className="btn btn-s btn-sm"
                            onClick={() => abrirAbono(c.clienteId, c.clienteNombre, null, c.saldoTotal.toString())}
                          >
                            Abonar
                          </button>
                        )}
                        <button type="button" className="btn btn-g btn-sm" onClick={() => elegirCliente(c.clienteId)}>
                          Ver cuenta
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {clienteSeleccionado && (
            <div style={{ width: 390, flex: 'none', display: 'flex' }}>
              <PanelClienteDeuda
                c={clienteSeleccionado}
                pagos={pagosValidos}
                negocioNombre={sesion.negocio.nombre}
                puedeCobrar={puedeCobrar}
                alAbonar={(vId, saldoObj) => abrirAbono(clienteSeleccionado.clienteId, clienteSeleccionado.clienteNombre, vId, saldoObj)}
                alCerrar={() => elegirCliente(null)}
              />
            </div>
          )}
        </div>
      );
    }
  } else {
    const vacioVenta =
      deudas.length === 0 ? (
        <EstadoVacio icono={HandCoins} titulo="No hay deudas" texto="Las ventas a crédito aparecerán aquí." />
      ) : (
        <EstadoVacio
          titulo="No encontramos deudas"
          texto={q ? `No hay deudas de “${q}” en este filtro.` : 'No hay deudas en este filtro.'}
          acciones={
            q ? (
              <button type="button" className="btn btn-q" onClick={() => setQ('')}>
                Limpiar búsqueda
              </button>
            ) : undefined
          }
        />
      );
    const tituloGrupo =
      filtroVenta === 'atencion'
        ? `Requiere atención · ${r.vencidas.length} ${r.vencidas.length === 1 ? 'vencida' : 'vencidas'}`
        : {
            proximas: 'Próximas a vencer',
            pendientes: 'Pendientes',
            pagadas: 'Pagadas este mes',
            todas: 'Todas las deudas',
          }[filtroVenta];

    if (listaVentas.length === 0) contenido = vacioVenta;
    else if (formato === 'telefono')
      contenido = (
        <section className="pila" aria-labelledby="ra">
          <h2 id="ra" className="lbl" style={{ color: filtroVenta === 'atencion' ? 'var(--error-texto)' : undefined }}>
            {tituloGrupo}
          </h2>
          {listaVentas.map((d) => (
            <article key={d.venta.id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="fila-entre" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 16, fontWeight: 600 }}>{d.venta.clienteNombre}</p>
                  <p className="t-aux num">Venta {d.folio}</p>
                </div>
                <div className="pila" style={{ alignItems: 'flex-end', gap: 4 }}>
                  {d.deuda && <InsigniaDeuda estado={d.deuda} />}
                  <InsigniaSync estado={d.sync} />
                </div>
              </div>
              <div className="fila-entre" style={{ alignItems: 'flex-end' }}>
                <div>
                  <p className="t-aux">{d.deuda === 'pagada' ? 'Total pagado' : 'Saldo pendiente'}</p>
                  <p className="num" style={{ fontSize: 22, fontWeight: 700, lineHeight: '28px' }}>
                    {formatoMXN(d.deuda === 'pagada' ? d.pagado : d.saldo)}
                  </p>
                </div>
                {d.venta.venceEl && d.deuda !== 'pagada' && (
                  <p className="t-aux num" style={{ textAlign: 'right', color: d.deuda === 'vencida' ? 'var(--error-texto)' : undefined, fontWeight: 600 }}>
                    {venceTexto(d)}
                    <br />
                    {textoDias(d.venta.venceEl)}
                  </p>
                )}
              </div>
              <div className="fila">
                {puedeCobrar && d.saldo.gt(0) && d.venta.clienteId && (
                  <button
                    type="button"
                    className="btn btn-s btn-sm"
                    style={{ flex: 1 }}
                    onClick={() => abrirAbono(d.venta.clienteId!, d.venta.clienteNombre ?? '', d.venta.id, d.saldo.toString())}
                  >
                    <HandCoins className="ic" />
                    Registrar abono
                  </button>
                )}
                <Link className="btn btn-g btn-sm" to={`/deudas/${d.venta.id}`}>
                  Ver detalle
                </Link>
              </div>
            </article>
          ))}
        </section>
      );
    else if (formato === 'tablet')
      contenido = (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <section className="card" aria-label="Lista de deudas" style={{ width: 290, flex: 'none', overflow: 'hidden' }}>
            <h2 className="lbl" style={{ padding: '12px 14px 6px', color: filtroVenta === 'atencion' ? 'var(--error-texto)' : undefined }}>
              {tituloGrupo}
            </h2>
            {listaVentas.map((d) => (
              <button key={d.venta.id} type="button" className="rowlink" aria-current={d.venta.id === ventaSeleccionada || undefined} onClick={() => elegirVenta(d.venta.id)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: 15 }}>{d.venta.clienteNombre}</p>
                  <p className="t-aux num">{venceTexto(d)}</p>
                </div>
                <div className="pila" style={{ alignItems: 'flex-end', gap: 4 }}>
                  <p className="num" style={{ fontWeight: 700 }}>{formatoMXN(d.deuda === 'pagada' ? d.pagado : d.saldo)}</p>
                  {d.deuda && <InsigniaDeuda estado={d.deuda} />}
                </div>
              </button>
            ))}
          </section>
          {ventaSeleccionada && <PanelDeuda key={ventaSeleccionada} ventaId={ventaSeleccionada} alCerrar={() => elegirVenta(null)} />}
        </div>
      );
    else
      contenido = (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          <div className="card tabla-card" style={{ flex: 1, minWidth: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Estado y vencimiento</th>
                  <th className="r">Saldo</th>
                  <th className="r">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {listaVentas.map((d) => (
                  <tr key={d.venta.id} className={d.venta.id === ventaSeleccionada ? 'sel' : undefined}>
                    <td>
                      <p style={{ fontWeight: 600 }}>{d.venta.clienteNombre}</p>
                      <p className="t-aux num">Venta {d.folio}</p>
                    </td>
                    <td>
                      <div className="fila" style={{ flexWrap: 'wrap', gap: 6 }}>
                        {d.deuda && <InsigniaDeuda estado={d.deuda} />}
                        {d.venta.venceEl && d.deuda !== 'pagada' && (
                          <span className="t-2 num">
                            {formatoDia(d.venta.venceEl)} · {textoDias(d.venta.venceEl)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="r num" style={{ fontWeight: 700 }}>
                      {formatoMXN(d.deuda === 'pagada' ? d.pagado : d.saldo)}
                    </td>
                    <td className="r">
                      <div className="fila" style={{ justifyContent: 'flex-end' }}>
                        {puedeCobrar && d.saldo.gt(0) && d.venta.clienteId && (
                          <button
                            type="button"
                            className="btn btn-s btn-sm"
                            onClick={() => abrirAbono(d.venta.clienteId!, d.venta.clienteNombre ?? '', d.venta.id, d.saldo.toString())}
                          >
                            Abonar
                          </button>
                        )}
                        <button type="button" className="btn btn-g btn-sm" onClick={() => elegirVenta(d.venta.id)}>
                          Ver detalle
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ventaSeleccionada && (
            <div style={{ width: 380, flex: 'none', display: 'flex' }}>
              <PanelDeuda key={ventaSeleccionada} ventaId={ventaSeleccionada} alCerrar={() => elegirVenta(null)} />
            </div>
          )}
        </div>
      );
  }

  const accionPrincipal = puedeCobrar && (
    <Link className="btn btn-p" to="/cobrar">
      <HandCoins className="ic" />
      Registrar abono
    </Link>
  );

  return (
    <>
      <EncabezadoPagina
        titulo="Deudas"
        subtitulo={`${r.clientes} ${r.clientes === 1 ? 'cliente' : 'clientes'} con saldo${formato === 'pc' ? ' pendiente' : ''}`}
        acciones={accionPrincipal}
      />
      <main className={`pag-main${formato === 'telefono' ? ' deudas-main' : ''}`}>
        <BannerSinConexion />
        {ultimoAbono && (
          <AvisoLinea tono="ok" icono={<CircleCheck className="ic" />}>
            <div className="fila-entre" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div>
                <strong>Abono registrado · {ultimoAbono.pago.clienteNombre}</strong>
                {formatoMXN(ultimoAbono.pago.monto)} en {ETIQUETA_METODO[ultimoAbono.pago.metodo].toLowerCase()} · saldo restante {formatoMXN(D(ultimoAbono.saldoRestante).lt(0) ? 0 : ultimoAbono.saldoRestante)}
              </div>
              <button type="button" className="btn btn-q btn-sm" onClick={() => void copiarComprobante()}>
                <Copy className="ic" />
                {comprobanteCopiado ? 'Copiado' : 'Copiar comprobante'}
              </button>
            </div>
          </AvisoLinea>
        )}

        <Kpis r={r} abonos={abonos} formato={formato} />

        <div className="deudas-cabecera-vista">
          <Segmentado<VistaDeudas>
            etiqueta="Modo de vista"
            valor={vista}
            alCambiar={setVista}
            opciones={[
              { valor: 'cliente', texto: 'Por cliente' },
              { valor: 'venta', texto: 'Por venta' },
            ]}
          />
        </div>

        <div className="fila">
          <Buscador valor={q} alCambiar={setQ} etiqueta="Buscar deuda" marcador="Cliente, venta o fecha" />
          {formato !== 'pc' && (
            <button type="button" className="btn btn-q" style={{ padding: '0 14px', flex: 'none' }} onClick={() => setHojaOrden(true)}>
              <SlidersHorizontal className="ic" />
              Ordenar
            </button>
          )}
        </div>

        {vista === 'cliente' ? chipsCliente : chipsVenta}
        {contenido}

        {abonos.recientes.length > 0 && (
          <section className="card" style={{ overflow: 'hidden' }} aria-label="Últimos abonos">
            <div className="fila-entre" style={{ padding: '14px 16px 6px' }}>
              <h2 className="lbl">Últimos abonos</h2>
              <Link to="/pagos" style={{ fontSize: 14, fontWeight: 600 }}>
                Ver movimientos
              </Link>
            </div>
            {abonos.recientes.slice(0, 5).map((p) => (
              <Link key={p.id} className="rowlink" to={`/clientes/${p.clienteId}`}>
                <span className="cuadro-ic" style={{ background: 'var(--ok-fondo)', color: 'var(--ok-texto)' }}>
                  <CircleCheck className="ic" />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: 15 }}>{p.clienteNombre}</p>
                  <p className="t-aux num">
                    {formatoRelativo(p.creadoEnDispositivo)} · {ETIQUETA_METODO[p.metodo]}
                    {p.nota ? ` · “${p.nota}”` : ''}
                  </p>
                  <InsigniaSync estado={sincronizacionDe(pagosInfo.porId, p.operacionId)} />
                </div>
                <p className="num deudas-abono-monto">+{formatoMXN(p.monto)}</p>
              </Link>
            ))}
          </section>
        )}
      </main>

      {formato === 'telefono' && puedeCobrar && (
        <Link className="btn btn-p btn-lg fab" to="/cobrar">
          <HandCoins className="ic" />
          Registrar abono
        </Link>
      )}

      {hojaOrden && (
        <HojaInferior titulo="Ordenar deudas" alCerrar={() => setHojaOrden(false)}>
          <div role="radiogroup" className="pila" aria-label="Orden">
            {(
              [
                ['vencimiento', 'Por fecha de vencimiento'],
                ['saldo', 'Por saldo, de mayor a menor'],
              ] as Array<[Orden, string]>
            ).map(([v, t]) => (
              <button
                key={v}
                type="button"
                role="radio"
                className="opt"
                aria-checked={orden === v}
                onClick={() => {
                  setOrden(v);
                  setHojaOrden(false);
                }}
              >
                <span className="radio" />
                {t}
              </button>
            ))}
          </div>
        </HojaInferior>
      )}

      {abonoModal && (
        <RegistrarPago
          clienteId={abonoModal.clienteId}
          clienteNombre={abonoModal.clienteNombre}
          ventaId={abonoModal.ventaId}
          saldo={abonoModal.saldo}
          alCerrar={() => setAbonoModal(null)}
          alRegistrar={(pago) => {
            const saldoAnterior = abonoModal.saldo;
            const saldoRestante = D(saldoAnterior).minus(pago.monto).toFixed(2);
            setAbonoModal(null);
            setComprobanteCopiado(false);
            setUltimoAbono({ pago, saldoAnterior, saldoRestante });
          }}
        />
      )}
    </>
  );
}
