import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../../api/cliente';
import { EstadoVacio, ErrorConsulta, Esqueleto } from '../../componentes/Estados';
import { Buscador, Chips } from '../../componentes/Formulario';
import type { CategoriaHistorial, EntradaHistorial } from '@micentralmx/shared/api';
import { useFormato } from '../../hooks/useFormato';
import { EncabezadoPagina, EncabezadoSecundario } from '../../layout/Encabezados';
import { diaLocal, diferenciaDias, formatoDia, formatoHora } from '../../lib/fechas';
import { useConectividad } from '../../sync/conectividad';

type Filtro = 'todo' | CategoriaHistorial;
const ETIQUETA: Record<string, string> = { ventas: 'Ventas', pagos: 'Pagos', inventario: 'Inventario', usuarios: 'Usuarios', compras: 'Compras', catalogo: 'Inventario', configuracion: 'Configuración', revisiones: 'Revisiones' };

function tituloDia(dia: string) {
  const dif = diferenciaDias(dia, diaLocal());
  return dif === 0 ? 'Hoy' : dif === 1 ? 'Ayer' : formatoDia(dia);
}

/** Pantalla 28 · Historial (auditoría del servidor, solo en línea). */
export default function Historial() {
  const formato = useFormato();
  const { enLinea } = useConectividad();
  const [params] = useSearchParams();
  const [filtro, setFiltro] = useState<Filtro>((params.get('categoria') as Filtro) || 'todo');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(texto), 300);
    return () => clearTimeout(t);
  }, [texto]);
  const consulta = useQuery({
    queryKey: ['historial', filtro, q],
    queryFn: () => {
      const p = new URLSearchParams();
      if (filtro !== 'todo') p.set('categoria', filtro);
      if (q.trim()) p.set('q', q.trim());
      return api<EntradaHistorial[]>('GET', `/historial?${p}`);
    },
  });
  const grupos = new Map<string, EntradaHistorial[]>();
  for (const e of consulta.data ?? []) {
    const d = diaLocal(e.fecha);
    grupos.set(d, [...(grupos.get(d) ?? []), e]);
  }

  return (
    <>
      {formato === 'telefono' ? <EncabezadoSecundario titulo="Historial" volverA="/mas" /> : <EncabezadoPagina titulo="Historial" />}
      <main className={`pag-main${formato === 'telefono' ? ' con-enc-sec' : ''}`}>
        <div className="pila-16" style={{ maxWidth: 820 }}>
          <Buscador valor={texto} alCambiar={setTexto} etiqueta="Buscar en historial" marcador="Buscar en el historial" />
          <Chips<Filtro>
            etiqueta="Categoría"
            valor={filtro}
            alCambiar={setFiltro}
            opciones={[
              { valor: 'todo', texto: 'Todo' },
              { valor: 'ventas', texto: 'Ventas' },
              { valor: 'pagos', texto: 'Pagos' },
              { valor: 'inventario', texto: 'Inventario' },
              { valor: 'compras', texto: 'Compras' },
              { valor: 'usuarios', texto: 'Usuarios' },
            ]}
          />
          {consulta.isPending ? (
            <Esqueleto texto="Cargando historial…" />
          ) : consulta.isError ? (
            <ErrorConsulta error={consulta.error} enLinea={enLinea} reintentar={() => void consulta.refetch()} />
          ) : grupos.size === 0 ? (
            <EstadoVacio icono={History} titulo="Sin registros" texto="No hay actividad con estos filtros." />
          ) : (
            [...grupos].map(([dia, entradas]) => (
              <section key={dia} className="pila">
                <h2 className="lbl">{tituloDia(dia)}</h2>
                <div className="card" style={{ overflow: 'hidden' }}>
                  {entradas.map((e) => (
                    <div key={e.id} className="rowlink" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 15, fontWeight: 500 }}>{e.descripcion}</p>
                        <p className="t-aux">
                          {formatoHora(e.fecha)} · {ETIQUETA[e.categoria] ?? e.categoria}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </main>
    </>
  );
}
