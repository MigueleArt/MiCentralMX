import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Truck, Plus, Check, LoaderCircle, CircleAlert, X } from 'lucide-react';
import { useAvisos } from '../../componentes/Avisos';
import { Esqueleto, AvisoLinea } from '../../componentes/Estados';
import { Campo, Entrada } from '../../componentes/Formulario';
import { ElegirEnLista } from '../../componentes/ElegirEnLista';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { useCatalogo, useProveedores } from '../../hooks/useDatosLocales';
import { diaLocal } from '../../lib/fechas';
import { D, sumar } from '../../lib/dinero';
import { registrarCarga } from '../../dominio/operaciones';
import { crearProveedor } from '../../dominio/enLinea';
import { useConectividad } from '../../sync/conectividad';
import { nuevoId } from '../../lib/ids';
import { db } from '../../db/db';
import { ErrorAlmacenamiento, ErrorValidacion } from '../../dominio/errores';
import { mensajeError } from '../../api/cliente';

export default function NuevaCarga() {
  const navegar = useNavigate();
  const avisar = useAvisos();
  const { enLinea } = useConectividad();
  const catalogo = useCatalogo();
  const proveedores = useProveedores();

  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(diaLocal());
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  // Modal para alta rápida de proveedor o rancho
  const [altaRapidaAbierta, setAltaRapidaAbierta] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoTipo, setNuevoTipo] = useState<'rancho_propio' | 'tercero'>('rancho_propio');
  const [guardandoOrigen, setGuardandoOrigen] = useState(false);
  const [errorOrigen, setErrorOrigen] = useState<string | null>(null);

  if (!catalogo || !proveedores) {
    return (
      <>
        <EncabezadoSecundario titulo="Nueva carga" volverA="/carga" cerrar />
        <main className="pag-main con-enc-sec">
          <Esqueleto filas={3} />
        </main>
      </>
    );
  }

  const cambiarCantidad = (clasificacionId: string, valor: string) => {
    setCantidades((prev) => ({ ...prev, [clasificacionId]: valor }));
  };

  const renglonesValidos = Object.entries(cantidades)
    .filter(([_, cant]) => {
      const d = D(cant || 0);
      return d.isFinite() && d.gt(0);
    })
    .map(([clasificacionId, cant]) => ({
      clasificacionId,
      cantidad: cant.trim(),
    }));

  const totalUnidades = sumar(renglonesValidos.map((r) => r.cantidad));

  const guardarAltaRapida = async () => {
    if (!nuevoNombre.trim()) {
      setErrorOrigen('Escribe el nombre del rancho o productor.');
      return;
    }
    setGuardandoOrigen(true);
    setErrorOrigen(null);
    try {
      let provId = nuevoId();
      if (enLinea) {
        const creado = await crearProveedor({ nombre: nuevoNombre.trim(), telefono: null, productos: '', tipo: nuevoTipo });
        provId = creado.id;
      } else {
        // En modo offline se guarda localmente en Dexie
        await db.proveedores.put({
          id: provId,
          nombre: nuevoNombre.trim(),
          telefono: null,
          productos: '',
          tipo: nuevoTipo,
          archivadoEn: null,
        });
      }
      setProveedorId(provId);
      setAltaRapidaAbierta(false);
      setNuevoNombre('');
      avisar(`Origen "${nuevoNombre.trim()}" agregado`);
    } catch (e) {
      setErrorOrigen(mensajeError(e));
    } finally {
      setGuardandoOrigen(false);
    }
  };

  const guardarCarga = async () => {
    setError(null);
    setErrores({});

    if (!proveedorId) {
      setErrores({ proveedor: 'Selecciona el rancho o productor de origen.' });
      return;
    }

    if (renglonesValidos.length === 0) {
      setError('Ingresa al menos una cantidad en alguna clasificación.');
      return;
    }

    setGuardando(true);
    try {
      await registrarCarga({
        proveedorId,
        fecha,
        renglones: renglonesValidos,
      });
      avisar(enLinea ? 'Carga registrada' : 'Carga guardada en este dispositivo');
      navegar('/carga', { replace: true });
    } catch (e) {
      if (e instanceof ErrorValidacion && e.campo) {
        setErrores({ [e.campo]: e.message });
      } else if (e instanceof ErrorAlmacenamiento) {
        setError('No se pudo guardar la carga localmente. El almacenamiento no respondió.');
      } else {
        setError(mensajeError(e));
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <EncabezadoSecundario titulo="Nueva carga del día" volverA="/carga" cerrar />
      <main className="pag-main con-enc-sec con-barra">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto', gap: 20 }}>
          {/* Origen */}
          <section className="pila">
            <div className="fila-entre" style={{ alignItems: 'center', marginBottom: 4 }}>
              <label className="step" htmlFor="origen">
                <b>1</b>Origen (Rancho o Proveedor)
              </label>
              <button
                type="button"
                className="btn btn-q"
                style={{ fontSize: 13, padding: '4px 8px' }}
                onClick={() => setAltaRapidaAbierta(true)}
              >
                <Plus className="ic" style={{ width: 14, height: 14 }} />
                Alta rápida
              </button>
            </div>

            <ElegirEnLista
              id="origen"
              titulo="Origen de la carga"
              marcador="Elegir rancho o proveedor"
              icono={<Truck className="ic" />}
              valor={proveedorId}
              opciones={proveedores.map((p) => ({
                valor: p.id,
                texto: p.nombre,
                detalle: p.tipo === 'rancho_propio' ? 'Rancho propio' : 'Productor tercero (consigna)',
              }))}
              alElegir={setProveedorId}
              invalido={!!errores.proveedor}
            />
            {errores.proveedor && <p className="err-msg">{errores.proveedor}</p>}
          </section>

          {/* Fecha */}
          <section className="pila">
            <label className="step" htmlFor="fecha">
              <b>2</b>Fecha de llegada
            </label>
            <Campo id="fecha" etiqueta="Fecha de llegada">
              <Entrada
                id="fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </Campo>
          </section>

          {/* Cantidades por clasificación */}
          <section className="pila">
            <label className="step">
              <b>3</b>Cantidades por clasificación
            </label>
            <p className="t-aux" style={{ marginBottom: 10 }}>
              Escribe las cantidades que llegaron hoy. Deja en blanco las que no apliquen.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {catalogo.map((prod) => (
                <div key={prod.producto.id} className="card" style={{ padding: 14, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderBottom: '1px solid var(--borde-tenue)', paddingBottom: 6 }}>
                    <p style={{ fontWeight: 700, fontSize: 15 }}>{prod.producto.nombre}</p>
                    <span className="t-aux">Unidad: {prod.unidad.nombre}</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {prod.clasificaciones.map((c) => {
                      const cid = c.clasificacion.id;
                      const val = cantidades[cid] ?? '';
                      return (
                        <div
                          key={cid}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            padding: '6px 0',
                            borderBottom: '1px solid var(--borde-tenue)',
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <p style={{ fontWeight: 600, fontSize: 14 }}>{c.clasificacion.nombre}</p>
                            <p className="t-aux" style={{ fontSize: 12 }}>
                              Existencia actual: {c.existencia.toString()} {prod.unidad.plural}
                            </p>
                          </div>
                          <div style={{ width: 110, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="number"
                              step={prod.unidad.permiteDecimales ? '0.01' : '1'}
                              min="0"
                              placeholder="0"
                              value={val}
                              onChange={(e) => cambiarCantidad(cid, e.target.value)}
                              className="entrada num"
                              style={{ textAlign: 'right', fontWeight: 600, fontSize: 16 }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Resumen inferior */}
          {totalUnidades.gt(0) && (
            <div className="card" style={{ padding: 14, background: 'var(--primario-fondo)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: 'var(--primario)' }}>Total en esta carga:</span>
              <span className="num" style={{ fontWeight: 700, fontSize: 18, color: 'var(--primario)' }}>
                {totalUnidades.toString()} unidades
              </span>
            </div>
          )}

          {error && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{error}</AvisoLinea>}

          <button
            type="button"
            className="btn btn-p btn-lg"
            disabled={guardando || totalUnidades.lte(0)}
            onClick={guardarCarga}
            style={{ marginTop: 8 }}
          >
            {guardando ? <LoaderCircle className="ic girar" /> : <Check className="ic" />}
            Registrar carga del día
          </button>
        </div>

        {/* Modal de Alta Rápida de Origen */}
        {altaRapidaAbierta && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <div className="card pila-16" style={{ width: '100%', maxWidth: 420, padding: 20 }}>
              <div className="fila-entre" style={{ alignItems: 'center' }}>
                <p style={{ fontWeight: 700, fontSize: 17 }}>Alta rápida de origen</p>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setAltaRapidaAbierta(false)}
                >
                  <X className="ic" />
                </button>
              </div>

              <Campo etiqueta="Tipo de origen" id="ar-tipo">
                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                    <input
                      type="radio"
                      name="ar-tipo"
                      checked={nuevoTipo === 'rancho_propio'}
                      onChange={() => setNuevoTipo('rancho_propio')}
                    />
                    Rancho propio
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                    <input
                      type="radio"
                      name="ar-tipo"
                      checked={nuevoTipo === 'tercero'}
                      onChange={() => setNuevoTipo('tercero')}
                    />
                    Productor externo
                  </label>
                </div>
              </Campo>

              <Campo etiqueta="Nombre del rancho o productor" id="ar-nombre">
                <Entrada
                  id="ar-nombre"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  placeholder="Ej. Rancho La Joya o Don Ale"
                  autoFocus
                />
              </Campo>

              {errorOrigen && <AvisoLinea tono="err">{errorOrigen}</AvisoLinea>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-s"
                  onClick={() => setAltaRapidaAbierta(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-p"
                  disabled={guardandoOrigen}
                  onClick={guardarAltaRapida}
                >
                  {guardandoOrigen ? <LoaderCircle className="ic girar" /> : 'Guardar y elegir'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
