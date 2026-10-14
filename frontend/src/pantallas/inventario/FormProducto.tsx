import { Archive, CircleAlert, LoaderCircle, Plus, Trash2, WifiOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { ElegirEnLista } from '../../componentes/ElegirEnLista';
import { AvisoLinea, Esqueleto } from '../../componentes/Estados';
import { Campo, Entrada, EntradaImporte } from '../../componentes/Formulario';
import { Dialogo } from '../../componentes/Superpuestos';
import { archivarProducto, crearProducto, editarProducto } from '../../dominio/enLinea';
import { cantidadConUnidad } from '../../dominio/formato';
import { useCatalogo, useUnidades } from '../../hooks/useDatosLocales';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { D } from '../../lib/dinero';
import { nuevoId } from '../../lib/ids';
import { useConectividad } from '../../sync/conectividad';

interface ClasForm {
  id: string;
  nombre: string;
  precio: string;
  existenciaInicial: string;
  nueva: boolean;
}

/**
 * Pantallas 17 (Crear producto), 18 (Editar producto) y 35 (Acción destructiva).
 * El catálogo se edita solo en línea; "Eliminar" se sustituye por archivar (decisiones técnicas §2.5).
 */
export default function FormProducto() {
  const { id } = useParams();
  const navegar = useNavigate();
  const avisar = useAvisos();
  const { puede } = useSesionActiva();
  const { enLinea } = useConectividad();
  const catalogo = useCatalogo(true);
  const unidades = useUnidades();
  const existente = id ? catalogo?.find((p) => p.producto.id === id) : undefined;

  const [nombre, setNombre] = useState<string | null>(id ? null : '');
  const [unidadId, setUnidadId] = useState<string | null>(null);
  const [umbral, setUmbral] = useState('');
  const [clas, setClas] = useState<ClasForm[]>([{ id: nuevoId(), nombre: '', precio: '', existenciaInicial: '', nueva: true }]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [archivar, setArchivar] = useState(false);

  if (id && existente && nombre === null) {
    setNombre(existente.producto.nombre);
    setUnidadId(existente.producto.unidadId);
    setUmbral(D(existente.producto.umbralBajo).toString());
    setClas(
      existente.clasificaciones
        .filter((c) => !c.clasificacion.archivadoEn)
        .map((c) => ({ id: c.clasificacion.id, nombre: c.clasificacion.nombre, precio: D(c.clasificacion.precio).toString(), existenciaInicial: '', nueva: false })),
    );
  }
  if (!catalogo || !unidades || nombre === null) {
    return (
      <>
        <EncabezadoSecundario titulo={id ? 'Editar producto' : 'Agregar producto'} cerrar />
        <main className="pag-main con-enc-sec"><Esqueleto filas={2} /></main>
      </>
    );
  }

  const unidad = unidades.find((u) => u.id === unidadId);
  const puedePrecios = !id || puede('catalogo.editar_precios');
  const deshabilitado = !enLinea || !puede('catalogo.editar');
  const actualizar = (cid: string, cambio: Partial<ClasForm>) => setClas((cs) => cs.map((c) => (c.id === cid ? { ...c, ...cambio } : c)));

  const validar = () => {
    const e: Record<string, string> = {};
    if (!nombre.trim()) e.nombre = 'Escribe el nombre del producto.';
    if (!unidadId) e.unidad = 'Elige cómo se vende.';
    if (umbral && !D(umbral).isFinite()) e.umbral = 'Escribe un número.';
    if (clas.length === 0) e.clas = 'Agrega al menos una clasificación.';
    clas.forEach((c) => {
      if (!c.nombre.trim()) e[`nombre-${c.id}`] = 'Escribe el nombre.';
      if (!c.precio || D(c.precio).lte(0)) e[`precio-${c.id}`] = 'Escribe el precio.';
      if (c.existenciaInicial && unidad && !unidad.permiteDecimales && !D(c.existenciaInicial).isInteger()) e[`exist-${c.id}`] = 'Solo enteros.';
    });
    setErrores(e);
    return Object.keys(e).length === 0;
  };

  const guardar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!validar()) return;
    setGuardando(true);
    setError(null);
    const datos = {
      nombre: nombre.trim(),
      unidadId: unidadId!,
      umbralBajo: umbral || '0',
      clasificaciones: clas.map((c) => ({ id: c.id, nombre: c.nombre.trim(), precio: c.precio, ...(c.nueva && c.existenciaInicial ? { existenciaInicial: c.existenciaInicial } : {}) })),
    };
    try {
      const p = id ? await editarProducto(id, datos) : await crearProducto(datos);
      avisar(id ? 'Cambios guardados' : 'Producto agregado');
      navegar(`/inventario/${id ?? p.id}`, { replace: true });
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  const confirmarArchivo = async () => {
    setGuardando(true);
    try {
      await archivarProducto(id!);
      avisar(`${existente?.producto.nombre} archivado`);
      navegar('/inventario', { replace: true });
    } catch (e) {
      setError(mensajeError(e));
      setArchivar(false);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <EncabezadoSecundario titulo={id ? 'Editar producto' : 'Agregar producto'} cerrar volverA={id ? `/inventario/${id}` : '/inventario'} />
      <main className="pag-main con-enc-sec">
        <form className="pila-16 contenedor-form" style={{ margin: '0 auto', gap: 20 }} onSubmit={(e) => void guardar(e)} noValidate>
          {!enLinea && (
            <AvisoLinea tono="warn" icono={<WifiOff className="ic" />}>
              <strong>Necesitas conexión</strong>
              Los productos y precios se editan en línea para que todos los dispositivos vean el mismo catálogo.
            </AvisoLinea>
          )}
          <Campo etiqueta="Nombre del producto" id="pn" error={errores.nombre}>
            <Entrada id="pn" placeholder="Ej. Jitomate Saladette" value={nombre} onChange={(e) => setNombre(e.target.value)} error={errores.nombre} />
          </Campo>
          <Campo etiqueta="Se vende por" id="un" error={errores.unidad}>
            <ElegirEnLista
              id="un"
              titulo="Se vende por"
              marcador="Elegir"
              valor={unidadId}
              opciones={unidades.filter((u) => !u.archivadoEn).map((u) => ({ valor: u.id, texto: u.nombre.charAt(0).toUpperCase() + u.nombre.slice(1), detalle: u.permiteDecimales ? 'Acepta decimales' : 'Solo cantidades enteras' }))}
              alElegir={setUnidadId}
              invalido={!!errores.unidad}
              conBusqueda={false}
            />
          </Campo>
          <Campo etiqueta="Aviso de inventario bajo" id="lw" error={errores.umbral} ayuda={unidad ? `Se avisa cuando una clasificación tenga ${umbral || '0'} ${unidad.plural} o menos.` : undefined}>
            <Entrada id="lw" inputMode={unidad?.permiteDecimales ? 'decimal' : 'numeric'} placeholder="Ej. 15" value={umbral} onChange={(e) => setUmbral(e.target.value.replace(/[^\d.]/g, ''))} error={errores.umbral} />
          </Campo>

          <section className="pila-12">
            <div>
              <h2 className="lbl">Clasificaciones</h2>
              <p className="hint">Cada clasificación tiene su propia existencia y precio.</p>
            </div>
            {errores.clas && <p className="err-msg">{errores.clas}</p>}
            {clas.map((c, i) => {
              const actual = existente?.clasificaciones.find((x) => x.clasificacion.id === c.id);
              return (
                <div key={c.id} className="card pila-12" style={{ padding: 14 }}>
                  <div className="fila" style={{ alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <Campo etiqueta={c.nueva ? 'Nombre de la clasificación' : 'Clasificación'} id={`cn-${c.id}`} error={errores[`nombre-${c.id}`]}>
                        <Entrada id={`cn-${c.id}`} placeholder={i === 0 ? 'Ej. Primera / Grande' : 'Ej. Segunda / Mediano'} value={c.nombre} onChange={(e) => actualizar(c.id, { nombre: e.target.value })} error={errores[`nombre-${c.id}`]} />
                      </Campo>
                    </div>
                    {clas.length > 1 && (
                      <button type="button" className="icon-btn" aria-label={`Quitar clasificación ${c.nombre || i + 1}`} onClick={() => setClas(clas.filter((x) => x.id !== c.id))} style={{ marginBottom: 2 }}>
                        <Trash2 className="ic" />
                      </button>
                    )}
                  </div>
                  <div className="rejilla-2" style={{ gap: 12 }}>
                    {c.nueva ? (
                      <Campo etiqueta="Existencia inicial" id={`cs-${c.id}`} error={errores[`exist-${c.id}`]}>
                        <Entrada id={`cs-${c.id}`} inputMode={unidad?.permiteDecimales ? 'decimal' : 'numeric'} placeholder="0" value={c.existenciaInicial} onChange={(e) => actualizar(c.id, { existenciaInicial: e.target.value.replace(/[^\d.]/g, '') })} />
                      </Campo>
                    ) : (
                      <div className="field">
                        <span className="flabel">Existencia</span>
                        <p className="num" style={{ minHeight: 48, display: 'flex', alignItems: 'center', fontWeight: 600 }}>
                          {actual && unidad ? cantidadConUnidad(actual.existencia.toString(), unidad) : '—'}
                        </p>
                      </div>
                    )}
                    <Campo etiqueta={unidad ? `Precio por ${unidad.nombre}` : 'Precio'} id={`cp-${c.id}`} error={errores[`precio-${c.id}`]}>
                      <EntradaImporte id={`cp-${c.id}`} valor={c.precio} alCambiar={(v) => actualizar(c.id, { precio: v })} placeholder="0.00" readOnly={!c.nueva && !puedePrecios} error={errores[`precio-${c.id}`]} />
                    </Campo>
                  </div>
                </div>
              );
            })}
            <button type="button" className="btn btn-q" onClick={() => setClas([...clas, { id: nuevoId(), nombre: '', precio: '', existenciaInicial: '', nueva: true }])}>
              <Plus className="ic" />
              Agregar clasificación
            </button>
            {id && <p className="hint">La existencia se ajusta desde Compras o Mermas / Ajustes. Quitar una clasificación la archiva; su historial se conserva.</p>}
            {id && !puedePrecios && <p className="hint">Tu rol no permite cambiar precios.</p>}
          </section>

          {error && (
            <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>
              {error}
            </AvisoLinea>
          )}
          <button type="submit" className="btn btn-p btn-lg" disabled={deshabilitado || guardando}>
            {guardando && <LoaderCircle className="ic girar" />}
            {id ? 'Guardar cambios' : 'Guardar producto'}
          </button>
          {id && (
            <button type="button" className="btn btn-g" style={{ color: 'var(--error-texto)' }} disabled={deshabilitado} onClick={() => setArchivar(true)}>
              <Archive className="ic" />
              Archivar producto
            </button>
          )}
        </form>
      </main>
      {archivar && existente && (
        <Dialogo
          titulo="¿Archivar este producto?"
          tono="peligro"
          icono={<Archive className="ic" />}
          alCerrar={() => setArchivar(false)}
          acciones={
            <>
              <button type="button" className="btn btn-d" disabled={guardando} onClick={() => void confirmarArchivo()}>
                Archivar
              </button>
              <button type="button" className="btn btn-q" onClick={() => setArchivar(false)}>
                Cancelar
              </button>
            </>
          }
        >
          <p className="t-2" style={{ fontSize: 15 }}>
            {existente.producto.nombre} y sus {existente.clasificaciones.length} clasificaciones dejarán de aparecer en el catálogo y en las búsquedas. Las ventas y
            movimientos pasados se conservan.
          </p>
        </Dialogo>
      )}
    </>
  );
}
