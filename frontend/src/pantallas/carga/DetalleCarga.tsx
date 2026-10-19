import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { CheckCircle2, Lock, AlertTriangle, WifiOff, LoaderCircle, Receipt, X } from 'lucide-react';
import { useDetalleCarga } from '../../hooks/useDatosLocales';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { Esqueleto, AvisoLinea } from '../../componentes/Estados';
import { useSesionActiva } from '../../auth/SesionContext';
import { useConectividad } from '../../sync/conectividad';
import { useAvisos } from '../../componentes/Avisos';
import { formatoDiaFecha, formatoHora } from '../../lib/fechas';
import { cerrarCarga } from '../../dominio/operaciones';
import { mensajeError } from '../../api/cliente';
import { folioVenta } from '../../dominio/formato';

export default function DetalleCarga() {
  const { id } = useParams<{ id: string }>();
  const detalle = useDetalleCarga(id);
  const { puede } = useSesionActiva();
  const { enLinea } = useConectividad();
  const avisar = useAvisos();

  const [modalCierre, setModalCierre] = useState(false);
  const [resoluciones, setResoluciones] = useState<Record<string, { accion: 'merma' | 'devolucion'; motivo: string }>>({});
  const [cerrando, setCerrando] = useState(false);
  const [errorCierre, setErrorCierre] = useState<string | null>(null);

  if (!detalle) {
    return (
      <>
        <EncabezadoSecundario titulo="Detalle de carga" volverA="/carga" />
        <main className="pag-main con-enc-sec">
          <Esqueleto filas={4} />
        </main>
      </>
    );
  }

  const { carga, proveedorNombre, proveedorTipo, renglones, ventas, totalCargado, totalVendido, totalMerma, totalQueda } = detalle;
  const sobrantes = renglones.filter((r) => r.queda.gt(0));

  const iniciarCierre = () => {
    // Inicializar resoluciones por defecto
    const inicial: Record<string, { accion: 'merma' | 'devolucion'; motivo: string }> = {};
    for (const s of sobrantes) {
      inicial[s.clasificacionId] = {
        accion: proveedorTipo === 'rancho_propio' ? 'merma' : 'devolucion',
        motivo: '',
      };
    }
    setResoluciones(inicial);
    setErrorCierre(null);
    setModalCierre(true);
  };

  const ejecutarCierre = async () => {
    setErrorCierre(null);
    if (!enLinea) {
      setErrorCierre('Cerrar carga requiere conexión a internet.');
      return;
    }

    setCerrando(true);
    try {
      const listaResoluciones = sobrantes.map((s) => ({
        clasificacionId: s.clasificacionId,
        accion: resoluciones[s.clasificacionId]?.accion ?? 'merma',
        motivo: resoluciones[s.clasificacionId]?.motivo || undefined,
      }));

      await cerrarCarga(carga.id, listaResoluciones);
      avisar('Carga cerrada correctamente');
      setModalCierre(false);
    } catch (e) {
      setErrorCierre(mensajeError(e));
    } finally {
      setCerrando(false);
    }
  };

  return (
    <>
      <EncabezadoSecundario
        titulo={`Carga · ${proveedorNombre}`}
        volverA="/carga"
        acciones={
          carga.estado === 'abierta' && puede('cargas.cerrar') ? (
            <button
              type="button"
              className="btn btn-p"
              style={{ padding: '6px 12px', fontSize: 14 }}
              onClick={iniciarCierre}
            >
              <Lock className="ic" style={{ width: 15, height: 15 }} />
              Cerrar carga
            </button>
          ) : undefined
        }
      />
      <main className="pag-main con-enc-sec con-barra">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto', gap: 20 }}>
          {/* Tarjeta de estado y metadatos */}
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 12,
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontWeight: 600,
                    background: carga.estado === 'abierta' ? 'var(--exito-fondo)' : 'var(--fondo-control)',
                    color: carga.estado === 'abierta' ? 'var(--exito-texto)' : 'var(--texto-tenue)',
                  }}
                >
                  {carga.estado === 'abierta' ? <CheckCircle2 className="ic" style={{ width: 13, height: 13 }} /> : <Lock className="ic" style={{ width: 13, height: 13 }} />}
                  {carga.estado === 'abierta' ? 'Carga abierta' : 'Carga cerrada'}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    padding: '3px 8px',
                    borderRadius: 4,
                    background: proveedorTipo === 'rancho_propio' ? 'var(--primario-fondo)' : 'var(--fondo-control)',
                    color: proveedorTipo === 'rancho_propio' ? 'var(--primario)' : 'var(--texto-tenue)',
                  }}
                >
                  {proveedorTipo === 'rancho_propio' ? 'Rancho propio' : 'Productor tercero'}
                </span>
              </div>
              <span className="t-aux">{formatoDiaFecha(carga.fecha)}</span>
            </div>

            <p style={{ fontSize: 16, fontWeight: 700 }}>{proveedorNombre}</p>
            <p className="t-aux" style={{ marginTop: 2 }}>
              Registrada por {carga.usuarioNombre} · {formatoHora(carga.creadoEnDispositivo)}
              {carga.cerradaEn && ` · Cerrada el ${formatoDiaFecha(carga.cerradaEn)}`}
            </p>

            {/* Cifras generales */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--borde-tenue)' }}>
              <div>
                <p className="t-aux" style={{ fontSize: 12 }}>Cargado</p>
                <p className="num" style={{ fontWeight: 700, fontSize: 18 }}>{totalCargado.toString()}</p>
              </div>
              <div>
                <p className="t-aux" style={{ fontSize: 12 }}>Vendido</p>
                <p className="num" style={{ fontWeight: 700, fontSize: 18, color: 'var(--exito-texto)' }}>{totalVendido.toString()}</p>
              </div>
              <div>
                <p className="t-aux" style={{ fontSize: 12 }}>Merma / Dev.</p>
                <p className="num" style={{ fontWeight: 700, fontSize: 18, color: 'var(--error-texto)' }}>{totalMerma.toString()}</p>
              </div>
              <div>
                <p className="t-aux" style={{ fontSize: 12 }}>Queda</p>
                <p className="num" style={{ fontWeight: 700, fontSize: 18, color: totalQueda.gt(0) ? 'var(--primario)' : 'var(--texto-tenue)' }}>
                  {totalQueda.toString()}
                </p>
              </div>
            </div>
          </div>

          {/* Desglose por clasificación */}
          <section className="pila">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Desglose por clasificación</h3>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--borde)', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', fontWeight: 600, fontSize: 12, color: 'var(--texto-tenue)' }}>
                <span>Clasificación</span>
                <span style={{ textAlign: 'right' }}>Cargado</span>
                <span style={{ textAlign: 'right' }}>Vendido</span>
                <span style={{ textAlign: 'right' }}>Merma</span>
                <span style={{ textAlign: 'right' }}>Queda</span>
              </div>
              {renglones.map((r) => (
                <div
                  key={r.clasificacionId}
                  style={{
                    padding: '12px 14px',
                    borderBottom: '1px solid var(--borde-tenue)',
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                    alignItems: 'center',
                    fontSize: 13,
                  }}
                >
                  <div>
                    <p style={{ fontWeight: 600 }}>{r.clasificacionNombre}</p>
                    <p className="t-aux">{r.productoNombre} ({r.unidadPlural})</p>
                  </div>
                  <span className="num" style={{ textAlign: 'right' }}>{r.cargado.toString()}</span>
                  <span className="num" style={{ textAlign: 'right', color: 'var(--exito-texto)' }}>{r.vendido.toString()}</span>
                  <span className="num" style={{ textAlign: 'right', color: 'var(--error-texto)' }}>{r.merma.toString()}</span>
                  <span className="num" style={{ textAlign: 'right', fontWeight: 700, color: r.queda.gt(0) ? 'var(--primario)' : 'var(--texto-tenue)' }}>
                    {r.queda.toString()}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Ventas de esta carga */}
          <section className="pila">
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Ventas asociadas ({ventas.length})</h3>
            {ventas.length === 0 ? (
              <div className="card" style={{ padding: 20, textAlign: 'center' }}>
                <p className="t-aux">Aún no se han registrado ventas de esta carga.</p>
              </div>
            ) : (
              <div className="card" style={{ overflow: 'hidden' }}>
                {ventas.map((v) => (
                  <Link
                    key={v.venta.id}
                    to={`/ventas/${v.venta.id}`}
                    className="rowlink"
                    style={{ padding: '12px 14px', borderBottom: '1px solid var(--borde-tenue)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textDecoration: 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="cuadro-ic">
                        <Receipt className="ic" />
                      </span>
                      <div>
                        <p style={{ fontWeight: 600, fontSize: 14 }}>
                          {folioVenta(v.venta)} · {v.clienteNombre || 'Público general'}
                        </p>
                        <p className="t-aux" style={{ fontSize: 12 }}>
                          {formatoHora(v.creadoEnDispositivo)} · Venta por {v.venta.total}
                        </p>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p className="num" style={{ fontWeight: 700, fontSize: 15, color: 'var(--exito-texto)' }}>
                        {v.cantidadTotalCarga.toString()}
                      </p>
                      <p className="t-aux" style={{ fontSize: 11 }}>unidades de esta carga</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Modal de Cierre de Carga */}
        {modalCierre && (
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
            <div className="card pila-16" style={{ width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto', padding: 20 }}>
              <div className="fila-entre" style={{ alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Lock className="ic" style={{ color: 'var(--primario)' }} />
                  <p style={{ fontWeight: 700, fontSize: 17 }}>Cerrar carga</p>
                </div>
                <button type="button" className="icon-btn" onClick={() => setModalCierre(false)}>
                  <X className="ic" />
                </button>
              </div>

              {!enLinea && (
                <AvisoLinea tono="warn" icono={<WifiOff className="ic" />}>
                  Cerrar la carga es una operación solo en línea. Conéctate a internet para continuar.
                </AvisoLinea>
              )}

              {sobrantes.length === 0 ? (
                <p className="t-2">
                  No quedan sobrantes en esta carga. Al cerrarla, ya no se podrán realizar más ventas con cargo a este folio.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--aviso-fondo)', color: 'var(--aviso-texto)', padding: 10, borderRadius: 6 }}>
                    <AlertTriangle className="ic" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 2 }} />
                    <p style={{ fontSize: 13, lineHeight: '18px' }}>
                      Esta carga tiene fruta sobrante ({totalQueda.toString()} unidades en total). Para poder cerrarla, resuelve cada sobrante como merma o devolución al productor.
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {sobrantes.map((s) => {
                      const res = resoluciones[s.clasificacionId] ?? { accion: 'merma', motivo: '' };
                      return (
                        <div key={s.clasificacionId} className="card" style={{ padding: 12, border: '1px solid var(--borde)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <p style={{ fontWeight: 600, fontSize: 14 }}>{s.clasificacionNombre}</p>
                            <span className="num" style={{ fontWeight: 700, color: 'var(--primario)' }}>
                              Quedan: {s.queda.toString()} {s.unidadPlural}
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`accion-${s.clasificacionId}`}
                                value="merma"
                                checked={res.accion === 'merma'}
                                onChange={() =>
                                  setResoluciones({
                                    ...resoluciones,
                                    [s.clasificacionId]: { ...res, accion: 'merma' },
                                  })
                                }
                              />
                              Registrar como Merma
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`accion-${s.clasificacionId}`}
                                value="devolucion"
                                checked={res.accion === 'devolucion'}
                                onChange={() =>
                                  setResoluciones({
                                    ...resoluciones,
                                    [s.clasificacionId]: { ...res, accion: 'devolucion' },
                                  })
                                }
                              />
                              Devolver al productor
                            </label>
                          </div>

                          <input
                            type="text"
                            placeholder="Motivo (opcional, ej. Dañada, devolución acordada)"
                            value={res.motivo}
                            onChange={(e) =>
                              setResoluciones({
                                ...resoluciones,
                                [s.clasificacionId]: { ...res, motivo: e.target.value },
                              })
                            }
                            className="entrada"
                            style={{ fontSize: 13, padding: '6px 10px' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {errorCierre && <AvisoLinea tono="err">{errorCierre}</AvisoLinea>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button type="button" className="btn btn-s" onClick={() => setModalCierre(false)}>
                  Dejar carga abierta
                </button>
                <button
                  type="button"
                  className="btn btn-p"
                  disabled={!enLinea || cerrando}
                  onClick={ejecutarCierre}
                >
                  {cerrando && <LoaderCircle className="ic girar" />}
                  Confirmar y cerrar carga
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
