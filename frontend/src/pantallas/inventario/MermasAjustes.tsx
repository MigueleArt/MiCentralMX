import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, CircleAlert, ClipboardList, LoaderCircle, PackageMinus, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { ElegirEnLista } from '../../componentes/ElegirEnLista';
import { AvisoLinea, Esqueleto } from '../../componentes/Estados';
import { Campo, Cantidad, Segmentado } from '../../componentes/Formulario';
import { InsigniaSync } from '../../componentes/Insignias';
import { db } from '../../db/db';
import { cargarOperaciones, catalogo as leerCatalogo, sincronizacionDe } from '../../dominio/consultas';
import { ajustarInventario } from '../../dominio/enLinea';
import { ErrorAlmacenamiento, ErrorValidacion } from '../../dominio/errores';
import { cantidadConUnidad, MOTIVOS_MERMA } from '../../dominio/formato';
import { registrarMerma } from '../../dominio/operaciones';
import { useCatalogo } from '../../hooks/useDatosLocales';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { D } from '../../lib/dinero';
import { formatoRelativo } from '../../lib/fechas';
import { useConectividad } from '../../sync/conectividad';

type Modo = 'merma' | 'ajuste';

/** Pantalla 19 · Mermas / Ajustes. Merma funciona sin conexión; ajuste solo en línea y con permiso. */
export default function MermasAjustes() {
  const { puede, soloLectura } = useSesionActiva();
  const { enLinea } = useConectividad();
  const avisar = useAvisos();
  const catalogo = useCatalogo();
  const [params] = useSearchParams();
  const [modo, setModo] = useState<Modo>(puede('inventario.merma') ? 'merma' : 'ajuste');
  const [productoId, setProductoId] = useState<string | null>(params.get('producto'));
  const [clasificacionId, setClasificacionId] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState('1');
  const [motivo, setMotivo] = useState<string>(MOTIVOS_MERMA[0]);
  const [motivoAjuste, setMotivoAjuste] = useState('Conteo físico');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const recientes = useLiveQuery(async () => {
    const [movs, prods, { porId }] = await Promise.all([
      db.movimientosInventario.where('creadoEn').above('').reverse().filter((m) => m.tipo === 'merma' || m.tipo === 'ajuste').limit(6).toArray(),
      leerCatalogo(true),
      cargarOperaciones(),
    ]);
    return movs
      .filter((m) => sincronizacionDe(porId, m.operacionId) !== 'rechazada')
      .map((m) => {
        const p = prods.find((x) => x.producto.id === m.productoId);
        const c = p?.clasificaciones.find((x) => x.clasificacion.id === m.clasificacionId);
        return { m, p, c, sync: sincronizacionDe(porId, m.operacionId) };
      });
  });

  if (!catalogo) {
    return (
      <>
        <EncabezadoSecundario titulo="Mermas / Ajustes" volverA="/mas" />
        <main className="pag-main con-enc-sec"><Esqueleto filas={2} /></main>
      </>
    );
  }

  const p = catalogo.find((x) => x.producto.id === productoId);
  const c = p?.clasificaciones.find((x) => x.clasificacion.id === clasificacionId);
  const puedeAjustar = puede('inventario.ajustar');
  const ajusteNoDisponible = !puedeAjustar ? 'Tu rol no permite ajustar inventario.' : !enLinea ? 'Los ajustes necesitan conexión: el servidor compara contra la existencia vigente.' : null;
  const cant = D(cantidad || 0);
  const despues = c ? (modo === 'merma' ? c.existencia.minus(cant) : cant) : null;

  const registrar = async () => {
    setErrores({});
    setError(null);
    if (!c) {
      setErrores({ producto: 'Elige el producto y su clasificación.' });
      return;
    }
    setGuardando(true);
    try {
      if (modo === 'merma') {
        await registrarMerma({ clasificacionId: c.clasificacion.id, cantidad, motivo, nota: null });
        avisar(enLinea ? 'Merma registrada' : 'Merma guardada en este dispositivo');
      } else {
        const r = await ajustarInventario({ clasificacionId: c.clasificacion.id, cantidadContada: cantidad, motivo: motivoAjuste });
        avisar(D(r.delta).isZero() ? 'La existencia ya coincidía' : `Ajuste guardado (${D(r.delta).isNegative() ? '' : '+'}${r.delta})`);
      }
      setCantidad(modo === 'merma' ? '1' : '');
    } catch (e) {
      if (e instanceof ErrorValidacion && e.campo) setErrores({ [e.campo]: e.message });
      else if (e instanceof ErrorAlmacenamiento) setError('No se pudo guardar en este dispositivo; el almacenamiento del navegador no respondió.');
      else setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <EncabezadoSecundario titulo="Mermas / Ajustes" volverA="/mas" />
      <main className="pag-main con-enc-sec con-barra">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto', gap: 20 }}>
          <Segmentado<Modo>
            etiqueta="Tipo de movimiento"
            valor={modo}
            alCambiar={(m) => {
              setModo(m);
              setCantidad(m === 'merma' ? '1' : c ? c.existencia.toString() : '');
            }}
            opciones={[
              { valor: 'merma', texto: 'Merma', icono: <PackageMinus className="ic" />, deshabilitado: !puede('inventario.merma') },
              { valor: 'ajuste', texto: 'Ajuste', icono: <ClipboardList className="ic" />, deshabilitado: !!ajusteNoDisponible },
            ]}
          />
          {ajusteNoDisponible && (
            <p className="hint" style={{ marginTop: -12, display: 'flex', gap: 6, alignItems: 'center' }}>
              {!enLinea && <WifiOff className="ic" style={{ width: 14, height: 14 }} />}
              Ajuste: {ajusteNoDisponible}
            </p>
          )}

          <Campo etiqueta="Producto" id="mp" error={errores.producto}>
            <ElegirEnLista
              id="mp"
              titulo="Producto"
              marcador="Elegir producto"
              valor={productoId}
              opciones={catalogo.map((x) => ({ valor: x.producto.id, texto: x.producto.nombre, detalle: cantidadConUnidad(x.total.toString(), x.unidad) }))}
              alElegir={(v) => {
                setProductoId(v);
                const primera = catalogo.find((x) => x.producto.id === v)?.clasificaciones[0];
                setClasificacionId(primera?.clasificacion.id ?? null);
                if (modo === 'ajuste') setCantidad(primera?.existencia.toString() ?? '');
              }}
              invalido={!!errores.producto}
            />
          </Campo>

          {p && (
            <fieldset className="pila">
              <legend className="flabel" style={{ marginBottom: 6 }}>
                Clasificación
              </legend>
              <div className="fila" style={{ flexWrap: 'wrap' }}>
                {p.clasificaciones.map((x) => (
                  <button
                    key={x.clasificacion.id}
                    type="button"
                    className="chip"
                    aria-pressed={x.clasificacion.id === clasificacionId}
                    onClick={() => {
                      setClasificacionId(x.clasificacion.id);
                      if (modo === 'ajuste') setCantidad(x.existencia.toString());
                    }}
                  >
                    {x.clasificacion.nombre}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {p && (
            <div className="field">
              <label className="flabel" htmlFor="mq">
                {modo === 'merma' ? `Cantidad (${p.unidad.plural})` : `Cantidad contada (${p.unidad.plural})`}
              </label>
              <Cantidad id="mq" valor={cantidad} alCambiar={setCantidad} decimales={p.unidad.permiteDecimales} unidad={p.unidad.nombre} invalido={!!errores.cantidad} />
              {errores.cantidad && <p className="err-msg">{errores.cantidad}</p>}
            </div>
          )}

          {modo === 'merma' ? (
            <Campo etiqueta="Motivo" id="mm" error={errores.motivo}>
              <ElegirEnLista id="mm" titulo="Motivo" valor={motivo} opciones={MOTIVOS_MERMA.map((m) => ({ valor: m, texto: m }))} alElegir={setMotivo} conBusqueda={false} />
            </Campo>
          ) : (
            <Campo etiqueta="Motivo" id="ma">
              <input id="ma" className="inp" value={motivoAjuste} onChange={(e) => setMotivoAjuste(e.target.value)} />
            </Campo>
          )}

          {c && p && despues && (
            <div className="card fila-entre" style={{ padding: '12px 14px', background: 'var(--fondo-tabla)' }}>
              <span className="t-2">Existencia de {c.clasificacion.nombre}</span>
              <span className="num fila" style={{ fontWeight: 700, gap: 6 }}>
                {c.existencia.toString()}
                <ArrowRight className="ic" style={{ width: 16, height: 16, color: 'var(--texto-2)' }} />
                <span style={{ color: despues.isNegative() ? 'var(--error-texto)' : undefined }}>{cantidadConUnidad(despues.toString(), p.unidad)}</span>
              </span>
            </div>
          )}
          {modo === 'ajuste' && <p className="hint">El servidor calcula la diferencia contra la existencia vigente al guardar.</p>}
          {error && (
            <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>
              {error}
            </AvisoLinea>
          )}

          <section className="pila">
            <div className="fila-entre">
              <h2 className="lbl">Registradas recientemente</h2>
              {puede('historial.ver') && (
                <Link to="/historial?categoria=inventario" style={{ fontSize: 14, fontWeight: 600 }}>
                  Ver todas
                </Link>
              )}
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              {recientes?.map(({ m, p: prod, c: cl, sync }) => (
                <div key={m.id} className="rowlink" style={{ cursor: 'default' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, fontSize: 15 }}>
                      {m.tipo === 'ajuste' ? 'Ajuste · ' : ''}
                      {prod?.producto.nombre} · {cl?.clasificacion.nombre.split(' / ')[0]}
                    </p>
                    <p className="t-aux">
                      {formatoRelativo(m.creadoEn)} · {m.motivo}
                    </p>
                    <InsigniaSync estado={sync} />
                  </div>
                  <p className="num" style={{ fontWeight: 700, color: D(m.delta).isNegative() ? 'var(--error-texto)' : 'var(--ok-texto)' }}>
                    {D(m.delta).isNegative() ? '−' : '+'}
                    {D(m.delta).abs().toString()}
                  </p>
                </div>
              ))}
              {recientes?.length === 0 && <p className="t-2" style={{ padding: 14 }}>Sin mermas ni ajustes recientes.</p>}
            </div>
          </section>
        </div>
      </main>
      <div className="barra-accion">
        <button
          type="button"
          className={`btn btn-lg ${modo === 'merma' ? 'btn-a' : 'btn-p'}`}
          style={{ flex: 1 }}
          disabled={guardando || soloLectura || !c || (modo === 'ajuste' && !!ajusteNoDisponible) || cantidad === ''}
          onClick={() => void registrar()}
        >
          {guardando && <LoaderCircle className="ic girar" />}
          {modo === 'merma'
            ? `Registrar merma${c && p && cant.gt(0) ? ` de ${cantidadConUnidad(cant.toString(), p.unidad)}` : ''}`
            : 'Guardar ajuste'}
        </button>
      </div>
    </>
  );
}
