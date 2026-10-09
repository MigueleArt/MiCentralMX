import { CircleAlert, CircleCheck, Clock, HandCoins, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Buscador, Chips, coincide } from '../../componentes/Formulario';
import { InsigniaDeuda, InsigniaSync } from '../../componentes/Insignias';
import { BannerSinConexion } from '../../componentes/Sincronizacion';
import { HojaInferior } from '../../componentes/Superpuestos';
import type { VentaVista } from '../../dominio/consultas';
import { resumenDeudas } from '../../dominio/resumenes';
import { useFormato } from '../../hooks/useFormato';
import { useDeudas } from '../../hooks/useDatosLocales';
import { EncabezadoPagina } from '../../layout/Encabezados';
import { formatoMXN } from '../../lib/dinero';
import { formatoDia, textoDias } from '../../lib/fechas';
import { PanelDeuda } from './DetalleDeuda';

type Filtro = 'atencion' | 'proximas' | 'pendientes' | 'pagadas' | 'todas';
type Orden = 'vencimiento' | 'saldo';

const venceTexto = (d: VentaVista) =>
  d.venta.venceEl ? `${d.deuda === 'vencida' ? 'Venció' : 'Vence'} ${formatoDia(d.venta.venceEl)}` : 'Sin vencimiento';

function Kpis({ r, formato }: { r: ReturnType<typeof resumenDeudas>; formato: string }) {
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
      {caja('Pagadas', formatoMXN(r.totalPagadoMes), 'Este mes', 'var(--ok-texto)', <CircleCheck style={ic} />)}
    </div>
  );
}

/** Pantalla 10 (Deudas), Deudas · Tablet 768 (maestro-detalle) y Deudas · PC 1440 (tabla y panel). */
export default function Deudas() {
  const { puede } = useSesionActiva();
  const formato = useFormato();
  const deudas = useDeudas();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('atencion');
  const [orden, setOrden] = useState<Orden>('vencimiento');
  const [hojaOrden, setHojaOrden] = useState(false);
  const seleccion = params.get('sel');
  const elegir = (id: string | null) => setParams(id ? { sel: id } : {}, { replace: true });

  if (!deudas) {
    return (
      <>
        <EncabezadoPagina titulo="Deudas" />
        <main className="pag-main"><Esqueleto texto="Cargando deudas…" /></main>
      </>
    );
  }

  const r = resumenDeudas(deudas);
  const busca = (d: VentaVista) => !q.trim() || coincide(`${d.venta.clienteNombre} ${d.folio} ${d.venta.venceEl ? formatoDia(d.venta.venceEl) : ''}`, q);
  const ordenar = (l: VentaVista[]) =>
    [...l].sort((a, b) => (orden === 'saldo' ? b.saldo.comparedTo(a.saldo) : (a.venta.venceEl ?? '9').localeCompare(b.venta.venceEl ?? '9')));
  const grupos: Record<Filtro, VentaVista[]> = {
    atencion: r.vencidas,
    proximas: r.proximas,
    pendientes: r.pendientes,
    pagadas: r.pagadasMes,
    todas: [...r.vencidas, ...r.proximas, ...r.pendientes],
  };
  const lista = ordenar(grupos[filtro].filter(busca));
  const ancho = formato !== 'telefono';
  const puedeCobrar = puede('pagos.registrar');
  const seleccionada = seleccion ?? (ancho ? lista[0]?.venta.id : undefined);

  const chips = (
    <Chips<Filtro>
      etiqueta="Filtrar deudas"
      valor={filtro}
      alCambiar={setFiltro}
      opciones={[
        { valor: 'atencion', texto: 'Requiere atención', cuenta: r.vencidas.length, icono: <CircleAlert className="ic" style={{ width: 16, height: 16 }} /> },
        { valor: 'proximas', texto: 'Próximas', cuenta: r.proximas.length },
        { valor: 'pendientes', texto: 'Pendientes', cuenta: r.pendientes.length },
        { valor: 'pagadas', texto: 'Pagadas' },
        ...(formato === 'pc' ? [{ valor: 'todas' as const, texto: 'Todas' }] : []),
      ]}
    />
  );

  const vacio =
    deudas.length === 0 ? (
      <EstadoVacio icono={HandCoins} titulo="No hay deudas" texto="Las ventas a crédito aparecerán aquí." />
    ) : (
      <EstadoVacio titulo="No encontramos deudas" texto={q ? `No hay deudas de “${q}” en este filtro.` : 'No hay deudas en este filtro.'} acciones={q ? <button type="button" className="btn btn-q" onClick={() => setQ('')}>Limpiar búsqueda</button> : undefined} />
    );

  const tituloGrupo =
    filtro === 'atencion' ? `Requiere atención · ${r.vencidas.length} ${r.vencidas.length === 1 ? 'vencida' : 'vencidas'}` : { proximas: 'Próximas a vencer', pendientes: 'Pendientes', pagadas: 'Pagadas este mes', todas: 'Todas' }[filtro];

  let contenido;
  if (lista.length === 0) contenido = vacio;
  else if (formato === 'telefono')
    contenido = (
      <section className="pila" aria-labelledby="ra">
        <h2 id="ra" className="lbl" style={{ color: filtro === 'atencion' ? 'var(--error-texto)' : undefined }}>
          {tituloGrupo}
        </h2>
        {lista.map((d) => (
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
              {puedeCobrar && d.saldo.gt(0) && (
                <Link className="btn btn-s btn-sm" style={{ flex: 1 }} to={`/deudas/${d.venta.id}?pago=1`}>
                  <HandCoins className="ic" />
                  Registrar pago
                </Link>
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
          <h2 className="lbl" style={{ padding: '12px 14px 6px', color: filtro === 'atencion' ? 'var(--error-texto)' : undefined }}>
            {tituloGrupo}
          </h2>
          {lista.map((d) => (
            <button key={d.venta.id} type="button" className="rowlink" aria-current={d.venta.id === seleccionada || undefined} onClick={() => elegir(d.venta.id)}>
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
        {seleccionada && <PanelDeuda key={seleccionada} ventaId={seleccionada} alCerrar={() => elegir(null)} />}
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
              {lista.map((d) => (
                <tr key={d.venta.id} className={d.venta.id === seleccionada ? 'sel' : undefined}>
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
                      {puedeCobrar && d.saldo.gt(0) && (
                        <Link className="btn btn-s btn-sm" to={`/deudas/${d.venta.id}?pago=1`}>
                          Registrar pago
                        </Link>
                      )}
                      <button type="button" className="btn btn-g btn-sm" onClick={() => elegir(d.venta.id)}>
                        Ver detalle
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {seleccionada && (
          <div style={{ width: 380, flex: 'none', display: 'flex' }}>
            <PanelDeuda key={seleccionada} ventaId={seleccionada} alCerrar={() => elegir(null)} />
          </div>
        )}
      </div>
    );

  return (
    <>
      <EncabezadoPagina titulo="Deudas" subtitulo={`${r.clientes} ${r.clientes === 1 ? 'cliente' : 'clientes'} con saldo${formato === 'pc' ? ' pendiente' : ''}`} />
      <main className="pag-main">
        <BannerSinConexion />
        <Kpis r={r} formato={formato} />
        {formato === 'telefono' && <p className="t-aux">Próximas: vencen en los siguientes 7 días · Pagadas: este mes</p>}
        <div className="fila">
          <Buscador valor={q} alCambiar={setQ} etiqueta="Buscar deuda" marcador="Cliente, operación o fecha" />
          {formato !== 'pc' && (
            <button type="button" className="btn btn-q" style={{ padding: '0 14px', flex: 'none' }} onClick={() => setHojaOrden(true)}>
              <SlidersHorizontal className="ic" />
              Filtrar
            </button>
          )}
        </div>
        {chips}
        {contenido}
      </main>
      {hojaOrden && (
        <HojaInferior titulo="Ordenar deudas" alCerrar={() => setHojaOrden(false)}>
          <div role="radiogroup" className="pila" aria-label="Orden">
            {(
              [
                ['vencimiento', 'Por fecha de vencimiento'],
                ['saldo', 'Por saldo, de mayor a menor'],
              ] as Array<[Orden, string]>
            ).map(([v, t]) => (
              <button key={v} type="button" role="radio" className="opt" aria-checked={orden === v} onClick={() => { setOrden(v); setHojaOrden(false); }}>
                <span className="radio" />
                {t}
              </button>
            ))}
          </div>
        </HojaInferior>
      )}
    </>
  );
}
