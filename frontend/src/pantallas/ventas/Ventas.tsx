import { ChevronRight, CloudUpload, Plus, Receipt, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Buscador, Chips } from '../../componentes/Formulario';
import { BannerSinConexion } from '../../componentes/Sincronizacion';
import type { EstadoVenta } from '@micentralmx/shared/entidades';
import { resumenVentas } from '../../dominio/resumenes';
import { useFormato } from '../../hooks/useFormato';
import { useClientes, useVentas } from '../../hooks/useDatosLocales';
import { EncabezadoPagina } from '../../layout/Encabezados';
import { formatoMXN } from '../../lib/dinero';
import { diaLocal, formatoDiaFecha, sumarDias } from '../../lib/fechas';
import { chipActivo, filtrarVentas, filtrosActivos, filtrosDeChip, FILTROS_INICIALES, type ChipVenta, type FiltrosVenta, type Periodo } from './filtros';
import { FiltrosVentas } from './FiltrosVentas';
import { TablaVentas, TarjetaVenta } from './ListaVentas';

const POR_PAGINA = 10;

/** Pantallas 05 (Ventas), 03 (Sin conexión), 30 (Estado vacío), 31 (Sin resultados), 34 (Cargando), Ventas · Tablet 768 y Ventas · PC 1440. */
export default function Ventas() {
  const { puede } = useSesionActiva();
  const formato = useFormato();
  const ventas = useVentas();
  const clientes = useClientes() ?? [];
  const [busqueda, setBusqueda] = useState('');
  const [filtros, setFiltros] = useState<FiltrosVenta>(FILTROS_INICIALES);
  const [hojaFiltros, setHojaFiltros] = useState(false);
  const [pagina, setPagina] = useState(0);

  const todas = ventas ?? [];
  const lista = filtrarVentas(todas, filtros, busqueda);
  const hoy = resumenVentas(todas);
  const ayer = resumenVentas(todas, sumarDias(diaLocal(), -1));
  const cuenta = (c: ChipVenta) => filtrarVentas(todas, filtrosDeChip(c), '').length;
  const sinSync = cuenta('sin_sync');
  const aplicar = (f: FiltrosVenta) => {
    setFiltros(f);
    setPagina(0);
  };
  const cambiarBusqueda = (q: string) => {
    setBusqueda(q);
    setPagina(0);
  };
  const ancho = formato !== 'telefono';
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const visibles = formato === 'pc' ? lista.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA) : lista;
  const hayFiltros = filtrosActivos(filtros) > 0 || busqueda.trim() !== '';
  const puedeCobrar = puede('pagos.registrar');

  const chips = (
    <Chips<ChipVenta>
      etiqueta="Filtros rápidos"
      valor={chipActivo(filtros)}
      alCambiar={(c) => aplicar(filtrosDeChip(c))}
      opciones={[
        { valor: 'hoy', texto: 'Hoy' },
        { valor: 'todas', texto: 'Todas' },
        { valor: 'credito', texto: 'Crédito', cuenta: cuenta('credito') },
        { valor: 'por_confirmar', texto: 'Por confirmar', cuenta: cuenta('por_confirmar') },
        ...(sinSync > 0 ? [{ valor: 'sin_sync' as const, texto: 'Sin sincronizar', cuenta: sinSync, icono: <CloudUpload className="ic" style={{ width: 16, height: 16 }} /> }] : []),
        { valor: 'canceladas', texto: 'Canceladas' },
      ]}
    />
  );

  const nuevaVenta = puede('ventas.crear') && (
    <Link className="btn btn-p" to="/ventas/nueva">
      <Plus className="ic" />
      Nueva venta
    </Link>
  );

  let contenido;
  if (!ventas) contenido = <Esqueleto texto="Cargando ventas…" />;
  else if (todas.length === 0)
    contenido = (
      <EstadoVacio
        icono={Receipt}
        titulo="No tienes ventas todavía"
        texto="Las ventas que registres aparecerán aquí."
        acciones={
          puede('ventas.crear') && (
            <Link className="btn btn-p" to="/ventas/nueva">
              <Plus className="ic" />
              Nueva venta
            </Link>
          )
        }
      />
    );
  else if (lista.length === 0)
    contenido = (
      <EstadoVacio
        titulo="No encontramos ventas"
        texto={busqueda.trim() ? `No hay ventas de “${busqueda.trim()}” con estos filtros.` : 'No hay ventas con estos filtros.'}
        acciones={
          <>
            {filtrosActivos(filtros) > 0 && (
              <button type="button" className="btn btn-q" onClick={() => aplicar({ ...FILTROS_INICIALES, periodo: 'todas' })}>
                Limpiar filtros
              </button>
            )}
            {busqueda && (
              <button type="button" className="btn btn-g" onClick={() => cambiarBusqueda('')}>
                Limpiar búsqueda
              </button>
            )}
          </>
        }
      />
    );
  else if (ancho) contenido = <TablaVentas ventas={visibles} completa={formato === 'pc'} puedeCobrar={puedeCobrar} />;
  else
    contenido = (
      <section aria-label="Lista de ventas" className="pila">
        {lista.map((v) => (
          <TarjetaVenta key={v.venta.id} v={v} puedeCobrar={puedeCobrar} />
        ))}
      </section>
    );

  return (
    <>
      <EncabezadoPagina titulo="Ventas" subtitulo={formatoDiaFecha()} acciones={nuevaVenta} />
      <main className="pag-main" style={formato === 'telefono' ? { paddingBottom: 88 } : undefined}>
        <BannerSinConexion />
        {ancho ? (
          <div className="rejilla-4">
            <div className="card kpi">
              <p className="t-aux" style={{ fontWeight: 600 }}>Ventas de hoy</p>
              <p className="valor num">{formatoMXN(hoy.total)}</p>
              {formato === 'pc' && <p className="t-aux num">vs. {formatoMXN(ayer.total)} ayer</p>}
            </div>
            <div className="card kpi">
              <p className="t-aux" style={{ fontWeight: 600 }}>{formato === 'pc' ? 'Ventas registradas' : 'Registradas'}</p>
              <p className="valor num">{hoy.cantidad}</p>
              {formato === 'pc' && <p className="t-aux num">{hoy.contado} de contado</p>}
            </div>
            <div className="card kpi">
              <p className="t-aux" style={{ fontWeight: 600 }}>{formato === 'pc' ? 'Ventas a crédito' : 'A crédito'}</p>
              <p className="valor num">{hoy.aCredito}</p>
              {formato === 'pc' && <p className="t-aux num">{formatoMXN(hoy.totalCredito)} en total</p>}
            </div>
            <Link className="card kpi" to="/deudas">
              <p className="t-aux" style={{ fontWeight: 600 }}>{formato === 'pc' ? 'Pendiente por cobrar' : 'Por cobrar'}</p>
              <p className="valor num">{formatoMXN(hoy.porCobrarDelDia)}</p>
              {formato === 'pc' && <p className="t-aux">De las ventas de hoy</p>}
            </Link>
          </div>
        ) : (
          <section className="card" aria-label="Resumen de ventas" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="fila-entre" style={{ alignItems: 'flex-end', gap: 12 }}>
              <div>
                <p className="t-2">Ventas de hoy</p>
                <p className="num" style={{ fontSize: 30, lineHeight: '36px', fontWeight: 700, letterSpacing: '-0.01em' }}>
                  {formatoMXN(hoy.total)}
                </p>
              </div>
              <p className="t-2 num" style={{ textAlign: 'right' }}>
                <strong style={{ color: 'var(--texto)', fontSize: 16 }}>{hoy.cantidad}</strong> {hoy.cantidad === 1 ? 'venta registrada' : 'ventas registradas'}
              </p>
            </div>
            <div className="rejilla-2" style={{ borderTop: '1px solid var(--gris-1)', paddingTop: 12 }}>
              <div>
                <p className="t-aux">Ventas a crédito</p>
                <p className="num" style={{ fontSize: 17, fontWeight: 700 }}>
                  {hoy.aCredito}
                </p>
              </div>
              <Link to="/deudas" style={{ textDecoration: 'none', color: 'var(--texto)' }}>
                <p className="t-aux">Pendiente por cobrar</p>
                <p className="num" style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {formatoMXN(hoy.porCobrarDelDia)}
                  <ChevronRight className="ic" style={{ width: 16, height: 16 }} />
                </p>
              </Link>
            </div>
          </section>
        )}

        {formato === 'pc' ? (
          <div className="fila" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div style={{ flex: '1 1 260px' }}>
              <Buscador valor={busqueda} alCambiar={cambiarBusqueda} etiqueta="Buscar venta" marcador="Número, cliente o fecha" />
            </div>
            <label className="sr" htmlFor="f-fecha">Fecha</label>
            <select id="f-fecha" className="inp" style={{ width: 'auto' }} value={filtros.periodo} onChange={(e) => aplicar({ ...filtros, periodo: e.target.value as Periodo })}>
              <option value="hoy">Fecha: Hoy</option>
              <option value="ayer">Fecha: Ayer</option>
              <option value="semana">Fecha: Esta semana</option>
              <option value="todas">Fecha: Todas</option>
              {filtros.periodo === 'rango' && <option value="rango">Fecha: Rango elegido</option>}
            </select>
            <label className="sr" htmlFor="f-estado">Estado</label>
            <select id="f-estado" className="inp" style={{ width: 'auto' }} value={filtros.estado ?? ''} onChange={(e) => aplicar({ ...filtros, estado: (e.target.value || null) as EstadoVenta | null })}>
              <option value="">Estado: Todos</option>
              <option value="completada">Completada</option>
              <option value="por_confirmar">Por confirmar</option>
              <option value="a_credito">Crédito pendiente</option>
              <option value="cancelada">Cancelada</option>
            </select>
            <label className="sr" htmlFor="f-tipo">Tipo de pago</label>
            <select id="f-tipo" className="inp" style={{ width: 'auto' }} value={filtros.tipo ?? ''} onChange={(e) => aplicar({ ...filtros, tipo: (e.target.value || null) as FiltrosVenta['tipo'] })}>
              <option value="">Tipo de pago: Todos</option>
              <option value="contado">Contado</option>
              <option value="credito">Crédito</option>
            </select>
            <label className="sr" htmlFor="f-cliente">Cliente</label>
            <select id="f-cliente" className="inp" style={{ width: 'auto', maxWidth: 240 }} value={filtros.clienteId ?? ''} onChange={(e) => aplicar({ ...filtros, clienteId: e.target.value || null })}>
              <option value="">Cliente: Todos</option>
              {clientes.map((c) => (
                <option key={c.cliente.id} value={c.cliente.id}>
                  {c.cliente.nombre}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-g" disabled={!hayFiltros} onClick={() => { aplicar({ ...FILTROS_INICIALES, periodo: 'todas' }); setBusqueda(''); }}>
              Limpiar filtros
            </button>
          </div>
        ) : (
          <>
            <div className="fila">
              <Buscador valor={busqueda} alCambiar={cambiarBusqueda} etiqueta="Buscar venta" marcador="Número, cliente o fecha" />
              <button type="button" className="btn btn-q" style={{ padding: '0 14px', flex: 'none' }} onClick={() => setHojaFiltros(true)}>
                <SlidersHorizontal className="ic" />
                Filtrar
                {filtrosActivos(filtros) > 0 && <span className="cnt">{filtrosActivos(filtros)}</span>}
              </button>
            </div>
            {chips}
          </>
        )}

        {contenido}

        {formato === 'pc' && lista.length > POR_PAGINA && (
          <div className="fila-entre">
            <p className="t-2 num">
              Mostrando {pagina * POR_PAGINA + 1}–{Math.min(lista.length, (pagina + 1) * POR_PAGINA)} de {lista.length} ventas
            </p>
            <div className="fila">
              <button type="button" className="btn btn-q btn-sm" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>
                Anterior
              </button>
              <button type="button" className="btn btn-q btn-sm" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)}>
                Siguiente
              </button>
            </div>
          </div>
        )}
      </main>

      {formato === 'telefono' && puede('ventas.crear') && (
        <Link className="btn btn-p btn-lg fab" to="/ventas/nueva">
          <Plus className="ic" />
          Nueva venta
        </Link>
      )}
      {hojaFiltros && (
        <FiltrosVentas inicial={filtros} ventas={todas} clientes={clientes} busqueda={busqueda} alAplicar={aplicar} alCerrar={() => setHojaFiltros(false)} />
      )}
    </>
  );
}
