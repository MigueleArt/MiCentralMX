import { ChevronRight, ClockAlert, MapPin, Phone, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Buscador, Chips } from '../../componentes/Formulario';
import { InsigniaCliente, InsigniaSync } from '../../componentes/Insignias';
import { BannerSinConexion } from '../../componentes/Sincronizacion';
import { filtrarOrdenarClientes, resumenClientes, type FiltroClientes, type OrdenClientes } from '../../dominio/clientes';
import { useFormato } from '../../hooks/useFormato';
import { useClientes } from '../../hooks/useDatosLocales';
import { EncabezadoPagina } from '../../layout/Encabezados';
import { formatoMXN } from '../../lib/dinero';
import { formatoRelativo } from '../../lib/fechas';
import { iniciales } from '../../lib/ids';
import './clientes.css';

/** Directorio de clientes con contexto de cartera, búsqueda, filtros y orden. */
export default function Clientes() {
  const { puede } = useSesionActiva();
  const formato = useFormato();
  const clientes = useClientes();
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<FiltroClientes>('todos');
  const [orden, setOrden] = useState<OrdenClientes>('nombre');

  const todos = useMemo(() => clientes ?? [], [clientes]);
  const resumen = useMemo(() => resumenClientes(todos), [todos]);
  const lista = useMemo(() => filtrarOrdenarClientes(todos, q, filtro, orden), [todos, q, filtro, orden]);
  const cuentas = useMemo(() => ({
    conSaldo: todos.filter((c) => c.saldo.gt(0)).length,
    vencida: todos.filter((c) => c.estado === 'vencida').length,
    proxima: todos.filter((c) => c.estado === 'proxima').length,
    alCorriente: todos.filter((c) => c.estado === 'al_corriente').length,
    sinSaldo: todos.filter((c) => c.estado === 'sin_saldo').length,
  }), [todos]);

  const agregar = puede('clientes.crear') && (
    <Link className="btn btn-p" to="/clientes/nuevo">
      <UserPlus className="ic" />
      Agregar cliente
    </Link>
  );

  return (
    <>
      <EncabezadoPagina titulo="Clientes" subtitulo={`${todos.length} ${todos.length === 1 ? 'cliente registrado' : 'clientes registrados'}`} acciones={agregar} />
      <main className="pag-main" style={formato === 'telefono' ? { paddingBottom: 88 } : undefined}>
        <BannerSinConexion />

        {clientes && todos.length > 0 && (
          <section className="clientes-resumen" aria-label="Resumen de clientes">
            <button type="button" className={`clientes-indicador${filtro === 'todos' ? ' activo' : ''}`} onClick={() => setFiltro('todos')}>
              <span className="clientes-indicador-etiqueta">Clientes</span>
              <strong className="clientes-indicador-valor num">{resumen.total}</strong>
              <span className="clientes-indicador-ayuda">Directorio completo</span>
            </button>
            <button type="button" className={`clientes-indicador${filtro === 'con_saldo' ? ' activo' : ''}`} onClick={() => setFiltro('con_saldo')}>
              <span className="clientes-indicador-etiqueta">Por cobrar</span>
              <strong className="clientes-indicador-valor num">{formatoMXN(resumen.saldoTotal)}</strong>
              <span className="clientes-indicador-ayuda">{resumen.conSaldo} con saldo</span>
            </button>
            <button type="button" className={`clientes-indicador alerta${filtro === 'vencida' ? ' activo' : ''}`} onClick={() => setFiltro('vencida')}>
              <span className="clientes-indicador-etiqueta">Saldo vencido</span>
              <strong className="clientes-indicador-valor num">{formatoMXN(resumen.saldoVencido)}</strong>
              <span className="clientes-indicador-ayuda">{resumen.vencidos} requieren atención</span>
            </button>
            <button type="button" className={`clientes-indicador${filtro === 'sin_saldo' ? ' activo' : ''}`} onClick={() => setFiltro('sin_saldo')}>
              <span className="clientes-indicador-etiqueta">Sin adeudo</span>
              <strong className="clientes-indicador-valor num">{resumen.sinSaldo}</strong>
              <span className="clientes-indicador-ayuda">Al día</span>
            </button>
          </section>
        )}

        <div className="clientes-controles">
          <Buscador valor={q} alCambiar={setQ} etiqueta="Buscar cliente" marcador="Nombre, teléfono o ubicación" />
          <div className="clientes-orden">
            <label htmlFor="orden-clientes">Ordenar por</label>
            <select id="orden-clientes" className="inp" value={orden} onChange={(e) => setOrden(e.target.value as OrdenClientes)}>
              <option value="nombre">Nombre</option>
              <option value="saldo_desc">Mayor saldo</option>
              <option value="actividad">Compra reciente</option>
            </select>
          </div>
        </div>

        <Chips<FiltroClientes>
          etiqueta="Filtrar clientes"
          valor={filtro}
          alCambiar={setFiltro}
          opciones={[
            { valor: 'todos', texto: 'Todos' },
            { valor: 'con_saldo', texto: 'Con saldo', cuenta: cuentas.conSaldo },
            { valor: 'vencida', texto: 'Vencidos', cuenta: cuentas.vencida },
            { valor: 'proxima', texto: 'Por vencer', cuenta: cuentas.proxima },
            { valor: 'al_corriente', texto: 'Al corriente', cuenta: cuentas.alCorriente },
            { valor: 'sin_saldo', texto: 'Sin saldo', cuenta: cuentas.sinSaldo },
          ]}
        />

        {!clientes ? (
          <Esqueleto texto="Cargando clientes…" />
        ) : todos.length === 0 ? (
          <EstadoVacio icono={Users} titulo="Aún no hay clientes" texto="Agrega a los clientes que compran a crédito o con frecuencia." acciones={agregar} />
        ) : lista.length === 0 ? (
          <EstadoVacio
            titulo="No encontramos clientes"
            texto={q ? `No hay clientes que coincidan con “${q}” dentro de este filtro.` : 'Ningún cliente cumple este filtro.'}
            acciones={<button type="button" className="btn btn-q" onClick={() => { setQ(''); setFiltro('todos'); }}>Limpiar filtros</button>}
          />
        ) : (
          <>
            <p className="t-aux" aria-live="polite">Mostrando {lista.length} de {todos.length}</p>
            <div className="clientes-lista">
              {lista.map((c) => (
                <Link key={c.cliente.id} className="cliente-tarjeta" to={`/clientes/${c.cliente.id}`}>
                  <span className="avatar">{iniciales(c.cliente.nombre)}</span>
                  <div className="cliente-tarjeta-principal">
                    <p className="cliente-tarjeta-nombre">{c.cliente.nombre}</p>
                    <div className="cliente-contacto">
                      {c.cliente.telefono && <span><Phone className="ic" />{c.cliente.telefono}</span>}
                      {c.cliente.ubicacion && <span><MapPin className="ic" />{c.cliente.ubicacion}</span>}
                      {!c.cliente.telefono && !c.cliente.ubicacion && <span>Sin datos de contacto</span>}
                    </div>
                    <div className="cliente-meta">
                      <span>{c.ultimaCompra ? `Última compra: ${formatoRelativo(c.ultimaCompra).replace(/^Hoy .*/, 'hoy')}` : 'Sin compras'}</span>
                      <span>{c.deudasAbiertas.length} {c.deudasAbiertas.length === 1 ? 'deuda abierta' : 'deudas abiertas'}</span>
                      {c.cliente.plazoDias && <span>Plazo: {c.cliente.plazoDias} días</span>}
                    </div>
                    <div className="cliente-tarjeta-insignias">
                      <InsigniaCliente estado={c.estado} />
                      <InsigniaSync estado={c.sync} />
                    </div>
                  </div>
                  <div className="cliente-tarjeta-saldo">
                    <strong className="num">{formatoMXN(c.saldo)}</strong>
                    <small>{c.saldo.gt(0) ? 'saldo pendiente' : 'sin adeudo'}</small>
                    {c.estado === 'vencida' && <span className="sr"><ClockAlert /> Deuda vencida</span>}
                  </div>
                  <ChevronRight className="ic cliente-tarjeta-chevron" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
      {formato === 'telefono' && puede('clientes.crear') && (
        <Link className="btn btn-p btn-lg fab" to="/clientes/nuevo">
          <UserPlus className="ic" />
          Agregar cliente
        </Link>
      )}
    </>
  );
}
