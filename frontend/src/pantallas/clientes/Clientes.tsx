import { ChevronRight, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Buscador, Chips, coincide } from '../../componentes/Formulario';
import { InsigniaCliente, InsigniaSync } from '../../componentes/Insignias';
import { BannerSinConexion } from '../../componentes/Sincronizacion';
import { useFormato } from '../../hooks/useFormato';
import { useClientes } from '../../hooks/useDatosLocales';
import { EncabezadoPagina } from '../../layout/Encabezados';
import { formatoMXN } from '../../lib/dinero';
import { formatoRelativo } from '../../lib/fechas';
import { iniciales } from '../../lib/ids';

type Filtro = 'todos' | 'saldo' | 'vencida';

/** Pantalla 20 · Clientes. */
export default function Clientes() {
  const { puede } = useSesionActiva();
  const formato = useFormato();
  const clientes = useClientes();
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const todos = clientes ?? [];
  const conSaldo = todos.filter((c) => c.saldo.gt(0));
  const vencidos = todos.filter((c) => c.estado === 'vencida');
  const lista = (filtro === 'saldo' ? conSaldo : filtro === 'vencida' ? vencidos : todos).filter((c) => coincide(`${c.cliente.nombre} ${c.cliente.telefono ?? ''}`, q));
  const agregar = puede('clientes.crear') && (
    <Link className="btn btn-p" to="/clientes/nuevo">
      <UserPlus className="ic" />
      Agregar cliente
    </Link>
  );

  return (
    <>
      <EncabezadoPagina titulo="Clientes" subtitulo={`${todos.length} ${todos.length === 1 ? 'cliente' : 'clientes'}`} acciones={agregar} />
      <main className="pag-main" style={formato === 'telefono' ? { paddingBottom: 88 } : undefined}>
        <BannerSinConexion />
        <Buscador valor={q} alCambiar={setQ} etiqueta="Buscar cliente" marcador="Buscar cliente o teléfono" />
        <Chips<Filtro>
          etiqueta="Filtrar clientes"
          valor={filtro}
          alCambiar={setFiltro}
          opciones={[
            { valor: 'todos', texto: 'Todos' },
            { valor: 'saldo', texto: 'Con saldo', cuenta: conSaldo.length },
            { valor: 'vencida', texto: 'Con deuda vencida', cuenta: vencidos.length },
          ]}
        />
        {!clientes ? (
          <Esqueleto texto="Cargando clientes…" />
        ) : todos.length === 0 ? (
          <EstadoVacio icono={Users} titulo="Aún no hay clientes" texto="Agrega a los clientes que compran a crédito o con frecuencia." acciones={agregar} />
        ) : lista.length === 0 ? (
          <EstadoVacio titulo="No encontramos clientes" texto={q ? `No hay clientes que coincidan con “${q}”.` : 'Ningún cliente cumple este filtro.'} />
        ) : (
          <div className="card" style={{ overflow: 'hidden', ...(formato === 'pc' ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))' } : {}) }}>
            {lista.map((c) => (
              <Link key={c.cliente.id} className="rowlink" to={`/clientes/${c.cliente.id}`}>
                <span className="avatar">{iniciales(c.cliente.nombre)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.cliente.nombre}</p>
                  <p className="t-aux">{c.ultimaCompra ? `Última compra: ${formatoRelativo(c.ultimaCompra).replace(/^Hoy .*/, 'hoy')}` : 'Sin compras'}</p>
                  <InsigniaSync estado={c.sync} />
                </div>
                <div className="pila" style={{ alignItems: 'flex-end', gap: 4 }}>
                  {c.saldo.gt(0) && (
                    <p className="num" style={{ fontWeight: 700 }}>
                      {formatoMXN(c.saldo)}
                    </p>
                  )}
                  <InsigniaCliente estado={c.estado} />
                </div>
                <ChevronRight className="ic" />
              </Link>
            ))}
          </div>
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
