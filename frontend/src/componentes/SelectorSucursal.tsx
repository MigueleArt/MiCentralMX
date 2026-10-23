import type { SucursalResumen } from '@micentralmx/shared/api';
import { Building2, Check, ChevronDown, LoaderCircle, Plus, Store } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { crearSucursal, listarSucursales } from '../api/sucursales';
import { cambiarSucursalSesion } from '../auth/sesion';
import { useSesionActiva } from '../auth/SesionContext';
import { AvisoLinea } from './Estados';
import { Campo, Entrada } from './Formulario';
import { HojaInferior } from './Superpuestos';
import { sincronizar } from '../sync/motor';

interface SelectorSucursalProps {
  /** Estilo compacto para colocar en barra superior o sidebar */
  compacto?: boolean;
}

export function SelectorSucursal({ compacto = false }: SelectorSucursalProps) {
  const { sesion } = useSesionActiva();
  const [abierto, setAbierto] = useState(false);
  const [sucursales, setSucursales] = useState<SucursalResumen[]>([]);
  const [cargando, setCargando] = useState(false);
  const [cambiandoId, setCambiandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Formulario de nueva sucursal
  const [mostrandoCrear, setMostrandoCrear] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [ubicacionNueva, setUbicacionNueva] = useState('');
  const [telefonoNuevo, setTelefonoNuevo] = useState('');
  const [creando, setCreando] = useState(false);
  const [errorCrear, setErrorCrear] = useState<string | null>(null);

  const esDueno = sesion.usuario.rolBase === 'dueno';

  const abrirSelector = async () => {
    setAbierto(true);
    setCargando(true);
    setError(null);
    try {
      const lista = await listarSucursales();
      setSucursales(lista);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las sucursales.');
    } finally {
      setCargando(false);
    }
  };

  const seleccionar = async (sucursal: SucursalResumen) => {
    if (sucursal.id === sesion.negocio.id) {
      setAbierto(false);
      return;
    }
    setCambiandoId(sucursal.id);
    setError(null);
    try {
      await cambiarSucursalSesion(sucursal.id);
      setAbierto(false);
      // Forzar sincronización de la nueva sucursal en segundo plano
      void sincronizar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cambiar de sucursal.');
    } finally {
      setCambiandoId(null);
    }
  };

  const guardarNueva = async (e: FormEvent) => {
    e.preventDefault();
    if (!nombreNuevo.trim()) {
      setErrorCrear('Escribe el nombre de la sucursal o bodega.');
      return;
    }
    setCreando(true);
    setErrorCrear(null);
    try {
      const nueva = await crearSucursal({
        nombre: nombreNuevo.trim(),
        ubicacion: ubicacionNueva.trim() || null,
        telefono: telefonoNuevo.trim() || null,
      });
      // Cambiar a la nueva sucursal creada
      await cambiarSucursalSesion(nueva.id);
      setMostrandoCrear(false);
      setAbierto(false);
      void sincronizar();
    } catch (err) {
      setErrorCrear(err instanceof Error ? err.message : 'Error al crear la sucursal.');
    } finally {
      setCreando(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`selector-sucursal-trigger${compacto ? ' compacto' : ''}`}
        onClick={abrirSelector}
        title="Cambiar de sucursal o bodega"
        aria-haspopup="dialog"
      >
        <span className="icono-sucursal">
          <Store className="ic" style={{ width: 16, height: 16 }} />
        </span>
        <span className="info-sucursal">
          <span className="nombre-sucursal">{sesion.negocio.nombre}</span>
          <span className="ubicacion-sucursal">
            {sesion.negocio.ubicacion || 'Sucursal activa'}
          </span>
        </span>
        <ChevronDown className="chevron-sucursal" style={{ width: 14, height: 14 }} />
      </button>

      {abierto && (
        <HojaInferior
          titulo={mostrandoCrear ? 'Nueva Sucursal o Bodega' : 'Sucursales de tu Empresa'}
          subtitulo={
            mostrandoCrear
              ? 'Registra un nuevo local para aislar su inventario y caja.'
              : `${sesion.negocio.nombre} · Cambia de sucursal sin salir de tu cuenta`
          }
          alCerrar={() => {
            setAbierto(false);
            setMostrandoCrear(false);
          }}
        >
          {error && <AvisoLinea tono="err">{error}</AvisoLinea>}

          {mostrandoCrear ? (
            <form onSubmit={guardarNueva} className="pila" style={{ gap: 16, marginTop: 16 }}>
              {errorCrear && <AvisoLinea tono="err">{errorCrear}</AvisoLinea>}

              <Campo id="sucursal-nombre" etiqueta="Nombre de la sucursal o bodega">
                <Entrada
                  id="sucursal-nombre"
                  placeholder="Ej. Bodega 2 · Nave K"
                  value={nombreNuevo}
                  onChange={(e) => setNombreNuevo(e.target.value)}
                  disabled={creando}
                  autoFocus
                />
              </Campo>

              <Campo id="sucursal-ubicacion" etiqueta="Ubicación en la Central" opcional>
                <Entrada
                  id="sucursal-ubicacion"
                  placeholder="Ej. Nave K, Pasillo 4, Local 12"
                  value={ubicacionNueva}
                  onChange={(e) => setUbicacionNueva(e.target.value)}
                  disabled={creando}
                />
              </Campo>

              <Campo id="sucursal-telefono" etiqueta="Teléfono de contacto" opcional>
                <Entrada
                  id="sucursal-telefono"
                  type="tel"
                  placeholder="Ej. 55 1234 5678"
                  value={telefonoNuevo}
                  onChange={(e) => setTelefonoNuevo(e.target.value)}
                  disabled={creando}
                />
              </Campo>

              <div className="fila-fin" style={{ gap: 12, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-sec"
                  onClick={() => setMostrandoCrear(false)}
                  disabled={creando}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-pri" disabled={creando}>
                  {creando && <LoaderCircle className="ic girar" style={{ width: 16, height: 16 }} />}
                  Crear y abrir sucursal
                </button>
              </div>
            </form>
          ) : (
            <div className="pila" style={{ gap: 12, marginTop: 16 }}>
              {cargando && (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <LoaderCircle className="ic girar" style={{ width: 24, height: 24, margin: '0 auto' }} />
                  <p className="t-aux" style={{ marginTop: 8 }}>
                    Cargando sucursales...
                  </p>
                </div>
              )}

              {!cargando && sucursales.length === 0 && (
                <p className="t-aux" style={{ textAlign: 'center', padding: '16px 0' }}>
                  No se encontraron otras sucursales registradas.
                </p>
              )}

              {!cargando &&
                sucursales.map((suc) => {
                  const esActual = suc.id === sesion.negocio.id;
                  const cambiandoEsta = cambiandoId === suc.id;

                  return (
                    <div
                      key={suc.id}
                      className={`tarjeta-sucursal${esActual ? ' activa' : ''}`}
                      onClick={() => !cambiandoEsta && seleccionar(suc)}
                      style={{
                        padding: 14,
                        borderRadius: 10,
                        border: esActual
                          ? '2px solid var(--color-primario, #16a34a)'
                          : '1px solid var(--borde-1, #e5e7eb)',
                        background: esActual
                          ? 'var(--color-primario-fondo, rgba(22, 163, 74, 0.05))'
                          : 'var(--fondo-tarjeta, #ffffff)',
                        cursor: esActual ? 'default' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            background: esActual ? 'var(--color-primario, #16a34a)' : '#f3f4f6',
                            color: esActual ? '#ffffff' : '#4b5563',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Building2 className="ic" style={{ width: 18, height: 18 }} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--texto-1)' }}>
                              {suc.nombre}
                            </span>
                            {suc.esMatriz && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  background: '#e0e7ff',
                                  color: '#3730a3',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  textTransform: 'uppercase',
                                }}
                              >
                                Matriz
                              </span>
                            )}
                          </div>
                          <p className="t-aux" style={{ fontSize: 12, marginTop: 2 }}>
                            {suc.ubicacion || 'Sin ubicación registrada'}
                            {suc.telefono ? ` · Tel. ${suc.telefono}` : ''}
                          </p>
                        </div>
                      </div>

                      <div>
                        {esActual ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              color: 'var(--color-primario, #16a34a)',
                            }}
                          >
                            <Check className="ic" style={{ width: 14, height: 14 }} />
                            Activa
                          </span>
                        ) : cambiandoEsta ? (
                          <LoaderCircle className="ic girar" style={{ width: 18, height: 18, color: 'var(--color-primario, #16a34a)' }} />
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-sec"
                            onClick={(e) => {
                              e.stopPropagation();
                              seleccionar(suc);
                            }}
                          >
                            Cambiar
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

              {esDueno && !cargando && (
                <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--borde-1, #e5e7eb)' }}>
                  <button
                    type="button"
                    className="btn btn-sec"
                    style={{ width: '100%', justifyContent: 'center', gap: 8 }}
                    onClick={() => setMostrandoCrear(true)}
                  >
                    <Plus className="ic" style={{ width: 16, height: 16 }} />
                    Agregar nueva sucursal o bodega
                  </button>
                </div>
              )}
            </div>
          )}
        </HojaInferior>
      )}
    </>
  );
}
