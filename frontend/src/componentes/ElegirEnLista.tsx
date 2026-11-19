import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { coincideTokens } from '../dominio/buscarProductos';
import { EstadoVacio } from './Estados';
import { Buscador } from './Formulario';
import { HojaInferior } from './Superpuestos';

export interface OpcionLista {
  valor: string;
  texto: string;
  detalle?: ReactNode;
  extra?: ReactNode;
  busqueda?: string;
}

/** Selector con búsqueda en hoja inferior (producto, cliente, proveedor, motivo…). */
export function ElegirEnLista({
  id,
  titulo,
  opciones,
  valor,
  alElegir,
  marcador = 'Elegir',
  icono,
  invalido,
  pie,
  conBusqueda = true,
  buscarSiempre = false,
}: {
  id: string;
  titulo: string;
  opciones: OpcionLista[];
  valor: string | null;
  alElegir: (v: string) => void;
  marcador?: string;
  icono?: ReactNode;
  invalido?: boolean;
  pie?: (cerrar: () => void, busqueda: string) => ReactNode;
  conBusqueda?: boolean;
  buscarSiempre?: boolean;
}) {
  const [abierta, setAbierta] = useState(false);
  const [q, setQ] = useState('');
  const [indiceActivo, setIndiceActivo] = useState(0);
  const buscadorRef = useRef<HTMLInputElement>(null);
  const elegida = opciones.find((o) => o.valor === valor);
  const filtradas = opciones.filter((o) => coincideTokens(`${o.texto} ${o.busqueda ?? ''}`, q));
  const mostrarBuscador = conBusqueda && (buscarSiempre || opciones.length > 3);

  const cerrar = () => {
    setAbierta(false);
    setQ('');
    setIndiceActivo(0);
  };

  useEffect(() => {
    if (!abierta || !mostrarBuscador) return;
    const idFrame = requestAnimationFrame(() => buscadorRef.current?.focus());
    return () => cancelAnimationFrame(idFrame);
  }, [abierta, mostrarBuscador]);

  const alCambiarBusqueda = (nuevo: string) => {
    setQ(nuevo);
    setIndiceActivo(0);
  };

  const manejarTecla = (e: KeyboardEvent<HTMLInputElement>) => {
    if (filtradas.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndiceActivo((i) => (i + 1) % filtradas.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndiceActivo((i) => (i - 1 + filtradas.length) % filtradas.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const elegidaTeclado = filtradas[indiceActivo] ?? filtradas[0];
      if (elegidaTeclado) {
        alElegir(elegidaTeclado.valor);
        cerrar();
      }
    }
  };

  return (
    <>
      <button
        id={id}
        type="button"
        className="sel-box"
        aria-haspopup="dialog"
        aria-invalid={invalido || undefined}
        onClick={() => setAbierta(true)}
        style={{ minHeight: icono ? 56 : 48, ...(invalido ? { borderColor: 'var(--color-error)', boxShadow: '0 0 0 1px var(--color-error)' } : {}) }}
      >
        <span className="fila" style={{ gap: 10, minWidth: 0 }}>
          {icono && elegida && <span className="cuadro-ic" style={{ background: 'var(--color-primario-suave)', color: 'var(--color-primario)' }}>{icono}</span>}
          <span style={{ fontWeight: elegida ? 600 : 400, color: elegida ? 'var(--texto)' : 'var(--texto-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {elegida?.texto ?? marcador}
          </span>
        </span>
        {elegida && icono ? (
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-primario)' }}>Cambiar</span>
        ) : (
          <ChevronDown className="ic" />
        )}
      </button>
      {abierta && (
        <HojaInferior titulo={titulo} alCerrar={cerrar}>
          {mostrarBuscador && (
            <Buscador
              valor={q}
              alCambiar={alCambiarBusqueda}
              etiqueta={`Buscar en ${titulo.toLowerCase()}`}
              marcador="Buscar"
              autoFocus
              inputRef={buscadorRef}
              onKeyDown={manejarTecla}
            />
          )}
          <div className="card" style={{ overflow: 'hidden' }}>
            {filtradas.map((o, i) => (
              <button
                key={o.valor}
                type="button"
                className="rowlink"
                aria-current={o.valor === valor || undefined}
                style={mostrarBuscador && i === indiceActivo && o.valor !== valor ? { background: 'var(--color-primario-tenue)' } : undefined}
                onClick={() => {
                  alElegir(o.valor);
                  cerrar();
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600 }}>{o.texto}</p>
                  {o.detalle && <p className="t-aux">{o.detalle}</p>}
                </div>
                {o.extra}
                {o.valor === valor && <Check className="ic" style={{ color: 'var(--color-primario)' }} />}
              </button>
            ))}
            {filtradas.length === 0 && <EstadoVacio titulo="Sin resultados" texto={`No hay coincidencias con “${q}”.`} />}
          </div>
          {pie?.(cerrar, q)}
        </HojaInferior>
      )}
    </>
  );
}
