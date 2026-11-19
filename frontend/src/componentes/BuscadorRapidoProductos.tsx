import { Eye, Plus } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useSesionActiva } from '../auth/SesionContext';
import { buscarProductosRapido, type ResultadoBusquedaProducto } from '../dominio/buscarProductos';
import { cantidadConUnidad } from '../dominio/formato';
import { useCatalogo } from '../hooks/useDatosLocales';
import { formatoMXN } from '../lib/dinero';
import { Esqueleto, EstadoVacio } from './Estados';
import { Buscador } from './Formulario';
import { InsigniaInventario } from './Insignias';
import { HojaInferior } from './Superpuestos';
import '../styles/buscadorRapido.css';

export const BuscadorProductosContext = createContext<() => void>(() => {});
export const useAbrirBuscadorProductos = () => useContext(BuscadorProductosContext);

/** Modal/hoja global para consultar precios, existencias o iniciar una venta con 1 clic. */
export function BuscadorRapidoProductos({ alCerrar }: { alCerrar: () => void }) {
  const catalogo = useCatalogo();
  const { puede } = useSesionActiva();
  const navegar = useNavigate();
  const [q, setQ] = useState('');
  const [indiceActivo, setIndiceActivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const idFrame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(idFrame);
  }, []);

  const resultados = catalogo ? buscarProductosRapido(catalogo, q, 15) : [];
  const puedeVender = puede('ventas.crear');

  const irAVender = (r: ResultadoBusquedaProducto) => {
    alCerrar();
    navegar(`/ventas/nueva?producto=${r.producto.producto.id}&clasificacion=${r.clasificacion.clasificacion.id}`);
  };

  const irAVer = (r: ResultadoBusquedaProducto) => {
    alCerrar();
    navegar(`/inventario/${r.producto.producto.id}`);
  };

  const manejarTecla = (e: KeyboardEvent<HTMLInputElement>) => {
    if (resultados.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndiceActivo((i) => (i + 1) % resultados.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndiceActivo((i) => (i - 1 + resultados.length) % resultados.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const elegido = resultados[indiceActivo] ?? resultados[0];
      if (!elegido) return;
      if (puedeVender) irAVender(elegido);
      else irAVer(elegido);
    }
  };

  return (
    <HojaInferior
      titulo="Buscador rápido de productos"
      subtitulo="Consulta precio y existencia, o agrega directo a una venta"
      alCerrar={alCerrar}
    >
      <Buscador
        valor={q}
        alCambiar={(nuevo) => {
          setQ(nuevo);
          setIndiceActivo(0);
        }}
        etiqueta="Buscar producto rápido"
        marcador="Producto, clasificación o unidad (ej. jit pri)…"
        autoFocus
        inputRef={inputRef}
        onKeyDown={manejarTecla}
      />

      <div className="buscador-rapido-ayuda">
        <span>{resultados.length} {resultados.length === 1 ? 'resultado' : 'resultados'}</span>
        <span>↑ ↓ para mover · Enter para {puedeVender ? 'vender' : 'ver detalle'}</span>
      </div>

      {!catalogo ? (
        <Esqueleto filas={2} />
      ) : resultados.length === 0 ? (
        <EstadoVacio
          titulo="Sin coincidencias"
          texto={`No hay productos que coincidan con “${q}”.`}
          acciones={
            q ? (
              <button type="button" className="btn btn-q" onClick={() => setQ('')}>
                Limpiar búsqueda
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card buscador-rapido-lista">
          {resultados.map((r, i) => (
            <div
              key={r.clasificacion.clasificacion.id}
              className={`buscador-rapido-fila${i === indiceActivo ? ' activo' : ''}`}
            >
              <div className="buscador-rapido-info">
                <div className="buscador-rapido-titulo">
                  <span>{r.producto.producto.nombre}</span>
                  <span className="buscador-rapido-clasificacion">{r.clasificacion.clasificacion.nombre}</span>
                </div>
                <div className="t-aux" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>
                    Disp: {cantidadConUnidad(r.clasificacion.existencia.toString(), r.producto.unidad)}
                  </span>
                  <InsigniaInventario bajo={r.clasificacion.bajo} sin={r.clasificacion.sinExistencia} />
                </div>
              </div>
              <div className="buscador-rapido-acciones">
                <div className="buscador-rapido-precio">
                  <p className="num" style={{ fontWeight: 700 }}>{formatoMXN(r.clasificacion.clasificacion.precio)}</p>
                  <p className="t-aux">por {r.producto.unidad.nombre}</p>
                </div>
                {puedeVender && (
                  <button
                    type="button"
                    className="btn btn-s btn-sm"
                    onClick={() => irAVender(r)}
                  >
                    <Plus className="ic" />
                    Vender
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-g btn-sm"
                  aria-label={`Ver ${r.producto.producto.nombre} ${r.clasificacion.clasificacion.nombre}`}
                  onClick={() => irAVer(r)}
                >
                  <Eye className="ic" />
                  Ver
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </HojaInferior>
  );
}
