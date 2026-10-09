import { Ellipsis, Package, PackageMinus, PackagePlus, Pencil, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Buscador, Chips, coincide } from '../../componentes/Formulario';
import { InsigniaInventario } from '../../componentes/Insignias';
import { BannerSinConexion } from '../../componentes/Sincronizacion';
import type { ProductoVista } from '../../dominio/consultas';
import { cantidadConUnidad } from '../../dominio/formato';
import { useFormato } from '../../hooks/useFormato';
import { useCatalogo } from '../../hooks/useDatosLocales';
import { EncabezadoPagina } from '../../layout/Encabezados';
import { formatoMXN } from '../../lib/dinero';
import Decimal from 'decimal.js';
import { AlertasConciliacion } from './AlertasConciliacion';

type Filtro = 'todos' | 'bajo' | 'sin';

/** Pantalla 15 (Inventario) e Inventario · PC 1440. */
export default function Inventario() {
  const { puede } = useSesionActiva();
  const formato = useFormato();
  const navegar = useNavigate();
  const catalogo = useCatalogo();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const filtro = (params.get('filtro') as Filtro) || 'todos';
  const setFiltro = (f: Filtro) => setParams(f === 'todos' ? {} : { filtro: f }, { replace: true });

  if (!catalogo) {
    return (
      <>
        <EncabezadoPagina titulo="Inventario" />
        <main className="pag-main"><Esqueleto texto="Cargando inventario…" /></main>
      </>
    );
  }

  const bajos = catalogo.filter((p) => p.clasificaciones.some((c) => c.bajo)).length;
  const sin = catalogo.filter((p) => p.clasificaciones.some((c) => c.sinExistencia)).length;
  const lista = catalogo.filter(
    (p) =>
      coincide(`${p.producto.nombre} ${p.clasificaciones.map((c) => c.clasificacion.nombre).join(' ')}`, q) &&
      (filtro === 'todos' || p.clasificaciones.some((c) => (filtro === 'bajo' ? c.bajo : c.sinExistencia))),
  );
  const existencia = (p: ProductoVista, e: Decimal) => cantidadConUnidad(e.toString(), p.unidad);

  const acciones = (
    <>
      {puede('inventario.merma') && (
        <Link className="btn btn-q" to="/inventario/mermas">
          <PackageMinus className="ic" />
          Registrar merma
        </Link>
      )}
      {puede('catalogo.editar') && (
        <Link className="btn btn-p" to="/inventario/nuevo">
          <PackagePlus className="ic" />
          Agregar producto
        </Link>
      )}
    </>
  );

  let contenido;
  if (catalogo.length === 0)
    contenido = (
      <EstadoVacio
        icono={Package}
        titulo="Aún no hay productos"
        texto="Agrega tus productos con sus clasificaciones, existencia y precio."
        acciones={puede('catalogo.editar') && <Link className="btn btn-p" to="/inventario/nuevo">Agregar producto</Link>}
      />
    );
  else if (lista.length === 0)
    contenido = <EstadoVacio titulo="No encontramos productos" texto={q ? `No hay productos que coincidan con “${q}”.` : 'Ningún producto cumple este filtro.'} />;
  else if (formato === 'telefono')
    contenido = (
      <section className="pila" aria-label="Productos">
        <div className="fila t-aux" style={{ padding: '0 14px', fontWeight: 600 }}>
          <span style={{ flex: 1 }}>Clasificación</span>
          <span style={{ width: 92, textAlign: 'right' }}>Existencia</span>
          <span style={{ width: 64, textAlign: 'right' }}>Precio</span>
        </div>
        {lista.map((p) => (
          <article key={p.producto.id} className="card" style={{ overflow: 'hidden' }}>
            <Link to={`/inventario/${p.producto.id}`} style={{ display: 'block', padding: '12px 14px 6px', textDecoration: 'none', color: 'var(--texto)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>{p.producto.nombre}</h3>
            </Link>
            {p.clasificaciones.map((c) => (
              <div key={c.clasificacion.id} className="fila" style={{ padding: '8px 14px', borderTop: '1px solid var(--gris-1)' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 15 }}>{c.clasificacion.nombre}</span>
                <span className="num" style={{ width: 92, textAlign: 'right', fontWeight: 600, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  {existencia(p, c.existencia)}
                  <InsigniaInventario bajo={c.bajo} sin={c.sinExistencia} />
                </span>
                <span className="num" style={{ width: 64, textAlign: 'right' }}>
                  {formatoMXN(c.clasificacion.precio)}
                </span>
              </div>
            ))}
          </article>
        ))}
      </section>
    );
  else
    contenido = (
      <div className="card tabla-card">
        <div className="tabla-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Clasificación</th>
                <th className="r">Existencia</th>
                <th className="r">Precio</th>
                <th>Estado</th>
                <th className="r">Acción</th>
              </tr>
            </thead>
            <tbody>
              {lista.flatMap((p) =>
                p.clasificaciones.map((c, i) => (
                  <tr key={c.clasificacion.id}>
                    <td>
                      {i === 0 && (
                        <Link to={`/inventario/${p.producto.id}`} style={{ textDecoration: 'none', color: 'var(--texto)' }}>
                          <p style={{ fontWeight: 600 }}>{p.producto.nombre}</p>
                          <p className="t-aux">Por {p.unidad.nombre}</p>
                        </Link>
                      )}
                    </td>
                    <td>{c.clasificacion.nombre}</td>
                    <td className="r num" style={{ fontWeight: 600 }}>{existencia(p, c.existencia)}</td>
                    <td className="r num">{formatoMXN(c.clasificacion.precio)}</td>
                    <td>
                      {c.sinExistencia || c.bajo ? (
                        <InsigniaInventario bajo={c.bajo} sin={c.sinExistencia} />
                      ) : (
                        <span className="bdg b-ok bdg-sm">Disponible</span>
                      )}
                    </td>
                    <td className="r">
                      <div className="fila" style={{ justifyContent: 'flex-end' }}>
                        {(c.bajo || c.sinExistencia) && puede('compras.crear') && (
                          <Link className="btn btn-s btn-sm" to={`/compras/nueva?clasificacion=${c.clasificacion.id}`}>
                            <ShoppingCart className="ic" />
                            Registrar compra
                          </Link>
                        )}
                        {puede('catalogo.editar') && (
                          <Link className="btn btn-g btn-sm" to={`/inventario/${p.producto.id}/editar`}>
                            <Pencil className="ic" />
                            Editar
                          </Link>
                        )}
                        <button type="button" className="icon-btn" title="Más acciones" aria-label={`Ver ${p.producto.nombre}`} onClick={() => navegar(`/inventario/${p.producto.id}`)}>
                          <Ellipsis className="ic" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </div>
    );

  return (
    <>
      <EncabezadoPagina
        titulo="Inventario"
        subtitulo={`${catalogo.length} ${catalogo.length === 1 ? 'producto' : 'productos'}${formato === 'pc' && bajos ? ` · ${bajos} con inventario bajo` : ''}`}
        acciones={acciones}
      />
      <main className="pag-main" style={formato === 'telefono' ? { paddingBottom: 88 } : undefined}>
        <BannerSinConexion />
        <AlertasConciliacion />
        <Buscador valor={q} alCambiar={setQ} etiqueta="Buscar producto" marcador="Buscar producto" />
        <Chips<Filtro>
          etiqueta="Filtrar inventario"
          valor={filtro}
          alCambiar={setFiltro}
          opciones={[
            { valor: 'todos', texto: 'Todos', cuenta: formato === 'pc' ? catalogo.length : undefined },
            { valor: 'bajo', texto: 'Inventario bajo', cuenta: bajos },
            { valor: 'sin', texto: 'Sin existencia', cuenta: sin },
          ]}
        />
        {contenido}
        {formato === 'telefono' && puede('inventario.merma') && (
          <Link className="btn btn-q" to="/inventario/mermas">
            <PackageMinus className="ic" />
            Mermas / Ajustes
          </Link>
        )}
      </main>
      {formato === 'telefono' && puede('catalogo.editar') && (
        <Link className="btn btn-p btn-lg fab" to="/inventario/nuevo">
          <PackagePlus className="ic" />
          Agregar producto
        </Link>
      )}
    </>
  );
}
