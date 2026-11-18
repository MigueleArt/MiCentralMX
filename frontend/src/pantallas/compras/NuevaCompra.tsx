import { Check, CircleAlert, LoaderCircle, Package, Plus, Trash2, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { ElegirEnLista } from '../../componentes/ElegirEnLista';
import { AvisoLinea, Esqueleto } from '../../componentes/Estados';
import { Campo, Cantidad, EntradaImporte, Segmentado } from '../../componentes/Formulario';
import { ErrorAlmacenamiento, ErrorValidacion } from '../../dominio/errores';
import { cantidadConUnidad } from '../../dominio/formato';
import { registrarCompra } from '../../dominio/operaciones';
import { useCatalogo, useProveedores } from '../../hooks/useDatosLocales';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN, sumar } from '../../lib/dinero';
import { diaLocal, formatoDia, sumarDias, textoDias } from '../../lib/fechas';
import { useConectividad } from '../../sync/conectividad';

interface Renglon {
  clave: number;
  productoId: string | null;
  clasificacionId: string | null;
  cantidad: string;
  costo: string;
}

/** Pantalla 24 · Nueva compra. Se registra sin conexión (decisiones técnicas §2.8). */
export default function NuevaCompra() {
  const navegar = useNavigate();
  const avisar = useAvisos();
  const [params] = useSearchParams();
  const { soloLectura, puede } = useSesionActiva();
  const { enLinea } = useConectividad();
  const catalogo = useCatalogo();
  const proveedores = useProveedores();
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [renglones, setRenglones] = useState<Renglon[] | null>(null);
  const [formaPago, setFormaPago] = useState<'contado' | 'credito'>('contado');
  const [venceEl, setVenceEl] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  if (!catalogo || !proveedores) {
    return (
      <>
        <EncabezadoSecundario titulo="Nueva compra" cerrar volverA="/compras" />
        <main className="pag-main con-enc-sec"><Esqueleto filas={2} /></main>
      </>
    );
  }

  // Preselección desde Inventario ("Registrar compra" de una clasificación o producto).
  if (renglones === null) {
    const clas = params.get('clasificacion');
    const prod = params.get('producto') ?? catalogo.find((p) => p.clasificaciones.some((c) => c.clasificacion.id === clas))?.producto.id ?? null;
    const p = catalogo.find((x) => x.producto.id === prod);
    const c = p?.clasificaciones.find((x) => x.clasificacion.id === clas) ?? p?.clasificaciones[0];
    setRenglones([{ clave: 1, productoId: p?.producto.id ?? null, clasificacionId: c?.clasificacion.id ?? null, cantidad: '1', costo: c?.clasificacion.ultimoCosto ? D(c.clasificacion.ultimoCosto).toString() : '' }]);
    return null;
  }

  const productoDe = (r: Renglon) => catalogo.find((p) => p.producto.id === r.productoId);
  const actualizar = (clave: number, cambio: Partial<Renglon>) => setRenglones(renglones.map((r) => (r.clave === clave ? { ...r, ...cambio } : r)));
  const completos = renglones.filter((r) => r.clasificacionId && D(r.cantidad || 0).gt(0));
  const total = sumar(completos.map((r) => D(r.costo || 0).times(r.cantidad)));

  const confirmar = async () => {
    setErrores({});
    setError(null);
    setGuardando(true);
    try {
      await registrarCompra({
        proveedorId: proveedorId ?? '',
        renglones: completos.map((r) => ({ clasificacionId: r.clasificacionId!, cantidad: r.cantidad, costo: r.costo })),
        formaPago,
        venceEl: formaPago === 'credito' ? venceEl : null,
      });
      avisar(enLinea ? 'Compra registrada' : 'Compra guardada en este dispositivo');
      navegar('/compras', { replace: true });
    } catch (e) {
      if (e instanceof ErrorValidacion && e.campo) setErrores({ [e.campo]: e.message });
      else if (e instanceof ErrorAlmacenamiento) setError('No se pudo guardar en este dispositivo; el almacenamiento del navegador no respondió. Tus datos siguen en el formulario.');
      else setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  let paso = 1;
  return (
    <>
      <EncabezadoSecundario titulo="Nueva compra" cerrar volverA="/compras" />
      <main className="pag-main con-enc-sec con-barra">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto', gap: 20 }}>
          <section className="pila">
            <label className="step" htmlFor="pv">
              <b>{paso++}</b>Proveedor
            </label>
            <ElegirEnLista
              id="pv"
              titulo="Proveedor"
              marcador="Elegir proveedor"
              icono={<Truck className="ic" />}
              valor={proveedorId}
              opciones={proveedores.map((p) => ({ valor: p.id, texto: p.nombre, detalle: p.productos }))}
              alElegir={setProveedorId}
              invalido={!!errores.proveedor}
              pie={(cerrar) =>
                puede('proveedores.gestionar') && (
                  <Link className="btn btn-q" to="/proveedores/nuevo" onClick={cerrar}>
                    <Plus className="ic" />
                    Agregar proveedor (en línea)
                  </Link>
                )
              }
            />
            {errores.proveedor && <p className="err-msg">{errores.proveedor}</p>}
          </section>

          {renglones.map((r, i) => {
            const p = productoDe(r);
            const c = p?.clasificaciones.find((x) => x.clasificacion.id === r.clasificacionId);
            const base = paso;
            if (i === renglones.length - 1) paso += 4;
            return (
              <div key={r.clave} className={renglones.length > 1 ? 'card pila-16' : 'pila-16'} style={renglones.length > 1 ? { padding: 14, gap: 20 } : { gap: 20 }}>
                {renglones.length > 1 && (
                  <div className="fila-entre">
                    <p className="lbl">Producto {i + 1}</p>
                    <button type="button" className="icon-btn" aria-label={`Quitar producto ${i + 1}`} onClick={() => setRenglones(renglones.filter((x) => x.clave !== r.clave))}>
                      <Trash2 className="ic" />
                    </button>
                  </div>
                )}
                <section className="pila">
                  <label className="step" htmlFor={`pp-${i}`}>
                    <b>{base}</b>Producto
                  </label>
                  <ElegirEnLista
                    id={`pp-${i}`}
                    titulo="Producto"
                    marcador="Elegir producto"
                    icono={<Package className="ic" />}
                    valor={r.productoId}
                    opciones={catalogo.map((x) => ({ valor: x.producto.id, texto: x.producto.nombre, detalle: cantidadConUnidad(x.total.toString(), x.unidad) }))}
                    alElegir={(v) => {
                      const np = catalogo.find((x) => x.producto.id === v);
                      const nc = np?.clasificaciones[0];
                      actualizar(r.clave, { productoId: v, clasificacionId: nc?.clasificacion.id ?? null, costo: nc?.clasificacion.ultimoCosto ? D(nc.clasificacion.ultimoCosto).toString() : '' });
                    }}
                    invalido={!!errores[`renglon-${i}`]}
                  />
                </section>
                {p && (
                  <fieldset className="pila">
                    <legend className="step" style={{ marginBottom: 8 }}>
                      <b>{base + 1}</b>Clasificación
                    </legend>
                    <div className="fila" style={{ flexWrap: 'wrap' }}>
                      {p.clasificaciones.map((x) => (
                        <button
                          key={x.clasificacion.id}
                          type="button"
                          className="chip"
                          aria-pressed={x.clasificacion.id === r.clasificacionId}
                          onClick={() => actualizar(r.clave, { clasificacionId: x.clasificacion.id, costo: x.clasificacion.ultimoCosto ? D(x.clasificacion.ultimoCosto).toString() : r.costo })}
                        >
                          {x.clasificacion.nombre}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
                {p && c && (
                  <>
                    <div className="field">
                      <label className="step" htmlFor={`cq-${i}`}>
                        <b>{base + 2}</b>Cantidad ({p.unidad.plural})
                      </label>
                      <Cantidad id={`cq-${i}`} valor={r.cantidad} alCambiar={(v) => actualizar(r.clave, { cantidad: v })} decimales={p.unidad.permiteDecimales} unidad={p.unidad.nombre} invalido={!!errores[`cantidad-${i}`]} />
                      {errores[`cantidad-${i}`] && <p className="err-msg">{errores[`cantidad-${i}`]}</p>}
                    </div>
                    <div className="field">
                      <label className="step" htmlFor={`cp-${i}`}>
                        <b>{base + 3}</b>Precio por {p.unidad.nombre}
                      </label>
                      <EntradaImporte id={`cp-${i}`} grande valor={r.costo} alCambiar={(v) => actualizar(r.clave, { costo: v })} placeholder="0" error={errores[`costo-${i}`]} />
                      {errores[`costo-${i}`] && <p className="err-msg">{errores[`costo-${i}`]}</p>}
                    </div>
                    {D(r.cantidad || 0).gt(0) && (
                      <p className="t-2 num" style={{ fontWeight: 600 }}>
                        La existencia de {c.clasificacion.nombre} pasará de {c.existencia.toString()} a {cantidadConUnidad(c.existencia.plus(r.cantidad).toString(), p.unidad)}.
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}

          <button
            type="button"
            className="enlace"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setRenglones([...renglones, { clave: Math.max(...renglones.map((r) => r.clave)) + 1, productoId: null, clasificacionId: null, cantidad: '1', costo: '' }])}
          >
            <Plus className="ic" />
            Agregar otro producto
          </button>

          <section className="pila">
            <p className="step">
              <b>{paso}</b>Forma de pago
            </p>
            <Segmentado<'contado' | 'credito'>
              etiqueta="Forma de pago"
              valor={formaPago}
              alCambiar={(f) => {
                setFormaPago(f);
                if (f === 'credito' && !venceEl) setVenceEl(sumarDias(diaLocal(), 15));
              }}
              opciones={[
                { valor: 'contado', texto: 'Contado' },
                { valor: 'credito', texto: 'Crédito' },
              ]}
            />
            {formaPago === 'credito' && (
              <Campo etiqueta="Vence" id="vence" error={errores.vence} ayuda={venceEl ? `${formatoDia(venceEl)} · ${textoDias(venceEl)}` : undefined}>
                <input id="vence" className="inp" type="date" value={venceEl} min={diaLocal()} onChange={(e) => setVenceEl(e.target.value)} />
              </Campo>
            )}
          </section>
          {error && (
            <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>
              {error}
            </AvisoLinea>
          )}
        </div>
      </main>
      <div className="barra-accion">
        <div style={{ flex: 1 }}>
          <p className="t-aux">Total</p>
          <p className="num" style={{ fontSize: 24, fontWeight: 700, lineHeight: '30px' }}>
            {formatoMXN(total)}
          </p>
        </div>
        <button type="button" className="btn btn-p btn-lg" style={{ flex: 1.3 }} disabled={guardando || soloLectura || completos.length === 0} onClick={() => void confirmar()}>
          {guardando ? <LoaderCircle className="ic girar" /> : <Check className="ic" />}
          Confirmar compra
        </button>
      </div>
    </>
  );
}
