import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CircleAlert,
  CloudUpload,
  Copy,
  FileSpreadsheet,
  HandCoins,
  Plus,
  SlidersHorizontal,
  Truck,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { AvisoLinea, EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Buscador, Chips } from '../../componentes/Formulario';
import { InsigniaSync } from '../../componentes/Insignias';
import { BannerSinConexion } from '../../componentes/Sincronizacion';
import { HojaInferior } from '../../componentes/Superpuestos';
import { db } from '../../db/db';
import { cargarOperaciones, sincronizacionDe } from '../../dominio/consultas';
import { descargarPagosExcel } from '../../dominio/exportarExcel';
import { CATEGORIAS_DINERO, ETIQUETA_METODO, folioVenta } from '../../dominio/formato';
import { useFormato } from '../../hooks/useFormato';
import { EncabezadoPagina, EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN, formatoMXNSigno } from '../../lib/dinero';
import { diaLocal, formatoFechaHora, formatoHora, formatoRelativo } from '../../lib/fechas';
import { copiarAlPortapapeles } from '../deudas/comprobantes';
import { FiltrosPagos as HojaFiltrosPagos } from './FiltrosPagos';
import {
  ETIQUETAS_CATEGORIA_PAGO,
  ETIQUETAS_ORDEN_PAGOS,
  agruparMovimientosPorDia,
  chipPagoActivo,
  contarFiltrosPagosActivos,
  crearFiltrosPagosIniciales,
  etiquetaPeriodoPagos,
  filtrarMovimientosPago,
  filtrosDesdeChipPago,
  resumenMovimientosPago,
  textoComprobanteMovimiento,
  type ChipPago,
  type FiltrosPagos,
  type MovimientoPagoVista,
  type ResumenPagos,
} from './filtros';
import { RegistrarMovimiento } from './RegistrarMovimiento';
import './pagos.css';

const ICONOS = {
  cobro: [HandCoins, 'var(--ok-fondo)', 'var(--ok-texto)'],
  ingreso: [ArrowDownLeft, 'var(--ok-fondo)', 'var(--ok-texto)'],
  egreso: [ArrowUpRight, 'var(--error-fondo)', 'var(--error-texto)'],
} as const;

function KpisPagos({
  resumen,
  filtros,
  formato,
}: {
  resumen: ResumenPagos;
  filtros: FiltrosPagos;
  formato: string;
}) {
  const balancePositivo = resumen.balance.gte(0);
  const etiquetaPeriodo = etiquetaPeriodoPagos(filtros);
  const contarTexto = (n: number) => `${n} ${n === 1 ? 'movimiento' : 'movimientos'}`;

  return (
    <div className="rejilla-4">
      <div className="card kpi">
        <p className="t-aux" style={{ color: 'var(--ok-texto)', fontWeight: 600 }}>
          Ingresos
        </p>
        <p className="valor num">{formatoMXN(resumen.ingresos)}</p>
        {formato !== 'telefono' && <p className="t-aux">{contarTexto(resumen.cantidadIngresos)}</p>}
      </div>
      <div className="card kpi">
        <p className="t-aux" style={{ color: 'var(--error-texto)', fontWeight: 600 }}>
          Egresos
        </p>
        <p className="valor num">{formatoMXN(resumen.egresos)}</p>
        {formato !== 'telefono' && <p className="t-aux">{contarTexto(resumen.cantidadEgresos)}</p>}
      </div>
      <div className="card kpi">
        <p className="t-aux" style={{ color: 'var(--texto-2)', fontWeight: 600 }}>
          Balance neto
        </p>
        <p
          className="valor num"
          style={{ color: balancePositivo ? 'var(--ok-texto)' : 'var(--error-texto)' }}
        >
          {formatoMXNSigno(resumen.balance)}
        </p>
        {formato !== 'telefono' && <p className="t-aux">{etiquetaPeriodo}</p>}
      </div>
      <div className="card kpi">
        <p className="t-aux" style={{ color: 'var(--texto-2)', fontWeight: 600 }}>
          Por método (neto)
        </p>
        <div className="pagos-kpi-metodos num">
          <div className="pagos-kpi-metodo-linea">
            <span className="t-aux">Efectivo</span>
            <strong>{formatoMXNSigno(resumen.efectivoNeto)}</strong>
          </div>
          <div className="pagos-kpi-metodo-linea">
            <span className="t-aux">Transferencia</span>
            <strong>{formatoMXNSigno(resumen.transferenciaNeto)}</strong>
          </div>
          {!resumen.otroNeto.isZero() && (
            <div className="pagos-kpi-metodo-linea">
              <span className="t-aux">Otro</span>
              <strong>{formatoMXNSigno(resumen.otroNeto)}</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilaMovimiento({
  m,
  seleccionado,
  alElegir,
}: {
  m: MovimientoPagoVista;
  seleccionado: boolean;
  alElegir: () => void;
}) {
  const [Icono, fondo, color] = ICONOS[m.icono];
  const fechaTexto = m.dia === diaLocal() ? `Hoy ${formatoHora(m.fecha)}` : formatoRelativo(m.fecha);

  return (
    <button
      type="button"
      className="rowlink pagos-fila"
      aria-current={seleccionado ? 'true' : undefined}
      onClick={alElegir}
    >
      <span className="cuadro-ic" style={{ background: fondo, color }}>
        <Icono className="ic" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, fontSize: 15 }}>{m.titulo}</p>
        <p className="t-aux pagos-meta">
          <span>{fechaTexto}</span>
          <span>· {m.subtitulo}</span>
          <span>· {m.usuarioNombre}</span>
        </p>
        {m.nota && <p className="pagos-nota">Nota: {m.nota}</p>}
        <InsigniaSync estado={m.sync} />
      </div>
      <div className="pila" style={{ alignItems: 'flex-end', gap: 4, flex: 'none' }}>
        <p className="num" style={{ fontWeight: 700, color: m.tipo === 'ingreso' ? 'var(--ok-texto)' : 'var(--error-texto)' }}>
          {formatoMXNSigno(m.tipo === 'ingreso' ? D(m.monto) : D(m.monto).neg())}
        </p>
        <span className={`bdg bdg-sm ${m.tipo === 'ingreso' ? 'b-ok' : 'b-errt'}`}>
          {m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}
        </span>
      </div>
    </button>
  );
}

function ContenidoDetalleMovimiento({
  m,
  negocio,
  puedeVerProveedor,
  enHoja,
  alCerrar,
}: {
  m: MovimientoPagoVista;
  negocio: string;
  puedeVerProveedor: boolean;
  enHoja?: boolean;
  alCerrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    const ok = await copiarAlPortapapeles(textoComprobanteMovimiento(m, negocio));
    if (ok) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    }
  };

  return (
    <>
      {!enHoja && (
        <div
          className="fila-entre"
          style={{ padding: '16px 20px', borderBottom: '1px solid var(--gris-1)', alignItems: 'flex-start' }}
        >
          <div style={{ minWidth: 0 }}>
            <p className="lbl" style={{ marginBottom: 4 }}>
              Detalle del movimiento
            </p>
            <h2 className="t-sec">{m.titulo}</h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Cerrar detalle" onClick={alCerrar}>
            <X className="ic" />
          </button>
        </div>
      )}

      <div className="pila-16" style={enHoja ? undefined : { padding: '16px 20px' }}>
        {enHoja && <p style={{ fontWeight: 700, fontSize: 17 }}>{m.titulo}</p>}

        <div className="fila-entre" style={{ alignItems: 'center' }}>
          <div>
            <p className="t-2">{m.tipo === 'ingreso' ? 'Ingreso recibido' : 'Egreso registrado'}</p>
            <p
              className="num"
              style={{
                fontSize: 30,
                lineHeight: '36px',
                fontWeight: 700,
                color: m.tipo === 'ingreso' ? 'var(--ok-texto)' : 'var(--error-texto)',
              }}
            >
              {formatoMXNSigno(m.tipo === 'ingreso' ? D(m.monto) : D(m.monto).neg())}
            </p>
          </div>
          <span className={`bdg ${m.tipo === 'ingreso' ? 'b-ok' : 'b-errt'}`}>
            {m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}
          </span>
        </div>

        {(m.requiereRevision || (m.excedente && D(m.excedente).gt(0))) && (
          <AvisoLinea tono="warn" icono={<CircleAlert className="ic" />}>
            {m.excedente && D(m.excedente).gt(0)
              ? `Este cobro generó un saldo a favor de ${formatoMXN(m.excedente)} sujeto a revisión.`
              : 'Este movimiento requiere revisión.'}
          </AvisoLinea>
        )}

        <div className="pagos-detalle-grid">
          <div>
            <p className="t-aux">Fecha y hora</p>
            <p className="num" style={{ fontWeight: 600, fontSize: 14 }}>
              {formatoFechaHora(m.fecha)}
            </p>
          </div>
          <div>
            <p className="t-aux">Método</p>
            <p style={{ fontWeight: 600, fontSize: 14 }}>{ETIQUETA_METODO[m.metodo]}</p>
          </div>
          <div>
            <p className="t-aux">Categoría</p>
            <p style={{ fontWeight: 600, fontSize: 14 }}>{m.categoriaNombre}</p>
          </div>
          <div>
            <p className="t-aux">Registrado por</p>
            <p style={{ fontWeight: 600, fontSize: 14 }}>{m.usuarioNombre}</p>
          </div>
        </div>

        {m.sync && (
          <div>
            <InsigniaSync estado={m.sync} />
          </div>
        )}

        {m.nota && (
          <section className="pila">
            <h3 className="lbl">Nota</h3>
            <p style={{ fontSize: 14 }}>{m.nota}</p>
          </section>
        )}

        {m.aplicaciones.length > 0 && (
          <section className="pila">
            <h3 className="lbl">Deudas aplicadas</h3>
            <div className="card" style={{ overflow: 'hidden' }}>
              {m.aplicaciones.map((a) => (
                <Link key={`${a.ventaId}-${a.folio}`} className="rowlink" to={`/deudas/${a.ventaId}`}>
                  <span style={{ flex: 1, fontWeight: 600 }}>Deuda {a.folio}</span>
                  <span className="num" style={{ fontWeight: 700 }}>
                    {formatoMXN(a.monto)}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="fila" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn-q btn-sm" onClick={() => void copiar()}>
            <Copy className="ic" />
            {copiado ? 'Copiado' : 'Copiar comprobante'}
          </button>
          {m.clienteId && (
            <Link className="btn btn-g btn-sm" to={`/clientes/${m.clienteId}`}>
              <UserRound className="ic" />
              Ver cliente
            </Link>
          )}
          {m.proveedorId && puedeVerProveedor && (
            <Link className="btn btn-g btn-sm" to={`/proveedores/${m.proveedorId}`}>
              <Truck className="ic" />
              Ver proveedor
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

/** Pantalla 25 · Pagos: cobros a clientes, pagos a proveedores e ingresos/egresos con filtros, buscador y detalle. */
export default function Pagos() {
  const { sesion, puede } = useSesionActiva();
  const formato = useFormato();
  const avisar = useAvisos();
  const [busqueda, setBusqueda] = useState('');
  const [filtros, setFiltros] = useState<FiltrosPagos>(() => crearFiltrosPagosIniciales());
  const [hojaFiltros, setHojaFiltros] = useState(false);
  const [seleccionadoId, setSeleccionadoId] = useState<string | null>(null);
  const [registrar, setRegistrar] = useState(false);

  const filas = useLiveQuery(async () => {
    const [pagos, dinero, ventas, proveedores, { porId }] = await Promise.all([
      db.pagos.toArray(),
      db.movimientosDinero.toArray(),
      db.ventas.toArray(),
      db.proveedores.toArray(),
      cargarOperaciones(),
    ]);

    const ventasPorId = new Map(ventas.map((v) => [v.id, v]));
    const proveedoresPorId = new Map(proveedores.map((p) => [p.id, p]));

    const lista: MovimientoPagoVista[] = [
      ...pagos.map((p): MovimientoPagoVista => {
        const aplicaciones = p.aplicaciones.map((a) => {
          const venta = ventasPorId.get(a.ventaId);
          return {
            ventaId: a.ventaId,
            folio: venta ? folioVenta(venta) : 'Venta',
            monto: a.monto,
          };
        });
        const detalleDeudas =
          aplicaciones.length === 1
            ? ` · Deuda ${aplicaciones[0].folio}`
            : aplicaciones.length > 1
              ? ` · ${aplicaciones.length} deudas (${aplicaciones.map((a) => a.folio).join(', ')})`
              : '';
        return {
          id: p.id,
          origen: 'pago',
          tipo: 'ingreso',
          icono: 'cobro',
          categoria: 'cobro_cliente',
          categoriaNombre: ETIQUETAS_CATEGORIA_PAGO.cobro_cliente,
          titulo: `Pago de cliente · ${p.clienteNombre}`,
          subtitulo: `${ETIQUETA_METODO[p.metodo]}${detalleDeudas}`,
          monto: p.monto,
          metodo: p.metodo,
          fecha: p.creadoEnDispositivo,
          dia: diaLocal(p.creadoEnDispositivo),
          usuarioNombre: p.usuarioNombre,
          nota: p.nota,
          excedente: D(p.excedente).gt(0) ? p.excedente : null,
          requiereRevision: p.requiereRevision,
          clienteId: p.clienteId,
          clienteNombre: p.clienteNombre,
          proveedorId: null,
          proveedorNombre: null,
          aplicaciones,
          sync: sincronizacionDe(porId, p.operacionId),
        };
      }),
      ...dinero.map((m): MovimientoPagoVista => {
        const prov = m.proveedorId ? proveedoresPorId.get(m.proveedorId) : undefined;
        return {
          id: m.id,
          origen: 'dinero',
          tipo: m.tipo,
          icono: m.tipo,
          categoria: m.categoria,
          categoriaNombre: CATEGORIAS_DINERO[m.categoria]?.nombre ?? m.categoria,
          titulo: m.tipo === 'ingreso' && m.categoria !== 'otro_ingreso' ? `Ingreso · ${m.concepto}` : m.concepto,
          subtitulo: ETIQUETA_METODO[m.metodo],
          monto: m.monto,
          metodo: m.metodo,
          fecha: m.creadoEn,
          dia: diaLocal(m.creadoEn),
          usuarioNombre: m.usuarioNombre,
          nota: null,
          excedente: null,
          requiereRevision: false,
          clienteId: null,
          clienteNombre: null,
          proveedorId: m.proveedorId,
          proveedorNombre: prov?.nombre ?? null,
          aplicaciones: [],
          sync: sincronizacionDe(porId, m.operacionId),
        };
      }),
    ];

    return lista.filter((f) => f.sync !== 'rechazada').sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  const todos = filas ?? [];
  const baseChips = filtrarMovimientosPago(
    todos,
    { ...filtros, tipo: 'todos', categoria: null, sinSincronizar: false },
    busqueda,
  );
  const lista = filtrarMovimientosPago(todos, filtros, busqueda);
  const resumen = resumenMovimientosPago(lista);
  const activos = contarFiltrosPagosActivos(filtros);
  const sinSync = baseChips.filter((m) => m.sync === 'pendiente' || m.sync === 'enviando').length;
  const seleccionado = lista.find((m) => m.id === seleccionadoId) ?? null;

  const puedeCobrar = puede('pagos.registrar');
  const puedeRegistrar = puede('dinero.registrar');
  const puedeVerProveedor = puede('compras.crear') || puede('proveedores.gestionar') || puede('liquidaciones.ver');

  const limpiarTodo = () => {
    setBusqueda('');
    setFiltros(crearFiltrosPagosIniciales());
  };

  const renderLista = () => {
    if (!filas) return <Esqueleto />;
    if (todos.length === 0) {
      return (
        <EstadoVacio
          icono={Wallet}
          titulo="Sin movimientos"
          texto="Los cobros, pagos a proveedores y otros ingresos o egresos aparecerán aquí."
        />
      );
    }
    if (lista.length === 0) {
      return (
        <EstadoVacio
          icono={Wallet}
          titulo="Sin resultados"
          texto={
            busqueda.trim()
              ? `No hay movimientos que coincidan con “${busqueda.trim()}”.`
              : 'No hay movimientos con los filtros seleccionados.'
          }
          acciones={
            <button type="button" className="btn btn-q" onClick={limpiarTodo}>
              Limpiar filtros
            </button>
          }
        />
      );
    }

    const agruparPorDia = filtros.orden === 'recientes' || filtros.orden === 'antiguos';
    const contenidoLista: ReactNode = agruparPorDia ? (
      agruparMovimientosPorDia(lista).map((g) => (
        <section key={g.dia} className="card" style={{ overflow: 'hidden' }} aria-label={`Movimientos de ${g.etiqueta}`}>
          <header className="pagos-grupo-enc">
            <div className="fila" style={{ gap: 8 }}>
              <strong style={{ fontSize: 14 }}>{g.etiqueta}</strong>
              <span className="t-aux">
                {g.movimientos.length} {g.movimientos.length === 1 ? 'movimiento' : 'movimientos'}
              </span>
            </div>
            <span
              className="num"
              style={{
                fontWeight: 700,
                fontSize: 13,
                color: g.balance.gte(0) ? 'var(--ok-texto)' : 'var(--error-texto)',
              }}
            >
              Balance {formatoMXNSigno(g.balance)}
            </span>
          </header>
          <div>
            {g.movimientos.map((m) => (
              <FilaMovimiento
                key={m.id}
                m={m}
                seleccionado={seleccionado?.id === m.id}
                alElegir={() => setSeleccionadoId((prev) => (prev === m.id ? null : m.id))}
              />
            ))}
          </div>
        </section>
      ))
    ) : (
      <div className="card" style={{ overflow: 'hidden' }}>
        {lista.map((m) => (
          <FilaMovimiento
            key={m.id}
            m={m}
            seleccionado={seleccionado?.id === m.id}
            alElegir={() => setSeleccionadoId((prev) => (prev === m.id ? null : m.id))}
          />
        ))}
      </div>
    );

    if (formato === 'pc' && seleccionado) {
      return (
        <div className="pagos-maestro-detalle">
          <div className="pagos-lista-col">{contenidoLista}</div>
          <aside className="card pagos-detalle-panel" aria-label="Detalle del movimiento">
            <ContenidoDetalleMovimiento
              key={seleccionado.id}
              m={seleccionado}
              negocio={sesion.negocio.nombre}
              puedeVerProveedor={puedeVerProveedor}
              alCerrar={() => setSeleccionadoId(null)}
            />
          </aside>
        </div>
      );
    }

    return <div className="pagos-lista-col">{contenidoLista}</div>;
  };

  const accionesEncabezado = (
    <div className="fila" style={{ gap: 8, flexWrap: 'wrap' }}>
      {puedeCobrar && (
        <Link className="btn btn-q" to="/cobrar">
          <HandCoins className="ic" />
          Cobrar a cliente
        </Link>
      )}
      {puedeRegistrar && (
        <button type="button" className="btn btn-p" onClick={() => setRegistrar(true)}>
          <Plus className="ic" />
          Registrar movimiento
        </button>
      )}
    </div>
  );

  const pillsActivas: string[] = [];
  if (filtros.periodo !== 'todos') pillsActivas.push(`Periodo: ${etiquetaPeriodoPagos(filtros)}`);
  if (filtros.metodo) pillsActivas.push(`Método: ${ETIQUETA_METODO[filtros.metodo]}`);
  if (filtros.categoria) pillsActivas.push(`Categoría: ${ETIQUETAS_CATEGORIA_PAGO[filtros.categoria]}`);
  if (filtros.tipo !== 'todos') pillsActivas.push(`Tipo: ${filtros.tipo === 'ingreso' ? 'Ingresos' : 'Egresos'}`);
  if (filtros.orden !== 'recientes') pillsActivas.push(`Orden: ${ETIQUETAS_ORDEN_PAGOS[filtros.orden]}`);
  if (filtros.sinSincronizar) pillsActivas.push('Sin sincronizar');
  if (busqueda.trim()) pillsActivas.push(`Búsqueda: “${busqueda.trim()}”`);

  return (
    <>
      {formato === 'telefono' ? (
        <EncabezadoSecundario titulo="Pagos" volverA="/mas" />
      ) : (
        <EncabezadoPagina
          titulo="Pagos"
          subtitulo="Ingresos, egresos y caja"
          acciones={puedeCobrar || puedeRegistrar ? accionesEncabezado : undefined}
        />
      )}

      <main className={`pag-main${formato === 'telefono' ? ' con-enc-sec con-barra' : ''}`}>
        <div className="pila-16">
          <BannerSinConexion />
          <KpisPagos resumen={resumen} filtros={filtros} formato={formato} />

          <div className="pagos-toolbar">
            <Buscador
              valor={busqueda}
              alCambiar={setBusqueda}
              etiqueta="Buscar movimientos"
              marcador="Buscar por cliente, proveedor, concepto, folio o nota"
            />
            <div className="pagos-toolbar-acciones">
              <button type="button" className="btn btn-q" onClick={() => setHojaFiltros(true)}>
                <SlidersHorizontal className="ic" />
                Filtros
                {activos > 0 && <span className="cnt">{activos}</span>}
              </button>
              <button
                type="button"
                className="btn btn-q"
                disabled={lista.length === 0}
                onClick={() => {
                  descargarPagosExcel({
                    negocio: sesion.negocio.nombre,
                    periodoEtiqueta: etiquetaPeriodoPagos(filtros),
                    movimientos: lista,
                    resumen,
                  });
                  avisar(`Excel descargado (${lista.length} ${lista.length === 1 ? 'movimiento' : 'movimientos'})`);
                }}
              >
                <FileSpreadsheet className="ic" />
                Exportar Excel
              </button>
            </div>
          </div>

          <Chips<ChipPago>
            etiqueta="Filtrar movimientos"
            valor={chipPagoActivo(filtros)}
            alCambiar={(c) => setFiltros(filtrosDesdeChipPago(c, filtros))}
            opciones={[
              { valor: 'todos', texto: 'Todos', cuenta: baseChips.length },
              { valor: 'ingreso', texto: 'Ingresos', cuenta: baseChips.filter((m) => m.tipo === 'ingreso').length },
              { valor: 'egreso', texto: 'Egresos', cuenta: baseChips.filter((m) => m.tipo === 'egreso').length },
              {
                valor: 'cobro_cliente',
                texto: 'Cobros a clientes',
                cuenta: baseChips.filter((m) => m.categoria === 'cobro_cliente').length,
              },
              {
                valor: 'pago_proveedor',
                texto: 'Pagos a proveedores',
                cuenta: baseChips.filter((m) => m.categoria === 'pago_proveedor').length,
              },
              ...(sinSync > 0 || filtros.sinSincronizar
                ? [
                    {
                      valor: 'sin_sync' as const,
                      texto: 'Sin sincronizar',
                      cuenta: sinSync,
                      icono: <CloudUpload className="ic" style={{ width: 16, height: 16 }} />,
                    },
                  ]
                : []),
            ]}
          />

          {pillsActivas.length > 0 && (
            <div className="pagos-filtros-activos">
              {pillsActivas.map((p) => (
                <span key={p} className="pagos-pill">
                  {p}
                </span>
              ))}
              <button type="button" className="btn btn-g btn-sm" onClick={limpiarTodo}>
                Limpiar filtros
              </button>
            </div>
          )}

          {renderLista()}
        </div>
      </main>

      {formato === 'telefono' && (puedeRegistrar || puedeCobrar) && (
        <div className="barra-accion">
          {puedeCobrar && (
            <Link className="btn btn-q btn-lg" to="/cobrar">
              <HandCoins className="ic" />
              Cobrar
            </Link>
          )}
          {puedeRegistrar && (
            <button type="button" className="btn btn-p btn-lg" style={{ flex: 1 }} onClick={() => setRegistrar(true)}>
              <Plus className="ic" />
              Registrar movimiento
            </button>
          )}
        </div>
      )}

      {hojaFiltros && (
        <HojaFiltrosPagos
          inicial={filtros}
          movimientos={todos}
          busqueda={busqueda}
          alAplicar={setFiltros}
          alCerrar={() => setHojaFiltros(false)}
        />
      )}

      {formato !== 'pc' && seleccionado && (
        <HojaInferior titulo="Detalle del movimiento" alCerrar={() => setSeleccionadoId(null)}>
          <ContenidoDetalleMovimiento
            key={seleccionado.id}
            m={seleccionado}
            negocio={sesion.negocio.nombre}
            puedeVerProveedor={puedeVerProveedor}
            enHoja
            alCerrar={() => setSeleccionadoId(null)}
          />
        </HojaInferior>
      )}

      {registrar && (
        <RegistrarMovimiento
          alCerrar={() => setRegistrar(false)}
          alRegistrar={(texto) => {
            setRegistrar(false);
            avisar(texto);
          }}
        />
      )}
    </>
  );
}
