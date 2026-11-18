import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { CircleAlert, Check, LoaderCircle, WifiOff } from 'lucide-react';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { Esqueleto, AvisoLinea } from '../../componentes/Estados';
import { useCatalogo } from '../../hooks/useDatosLocales';
import { useConectividad } from '../../sync/conectividad';
import { useAvisos } from '../../componentes/Avisos';
import { D, formatoMXN } from '../../lib/dinero';
import { editarPrecios } from '../../dominio/enLinea';
import { mensajeError } from '../../api/cliente';

export default function PreciosHoy() {
  const navegar = useNavigate();
  const avisar = useAvisos();
  const { enLinea } = useConectividad();
  const catalogo = useCatalogo();

  const [precios, setPrecios] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (catalogo && Object.keys(precios).length === 0) {
      const mapa: Record<string, string> = {};
      for (const prod of catalogo) {
        for (const c of prod.clasificaciones) {
          mapa[c.clasificacion.id] = c.clasificacion.precio;
        }
      }
      setPrecios(mapa);
    }
  }, [catalogo]);

  if (!catalogo) {
    return (
      <>
        <EncabezadoSecundario titulo="Precios de hoy" volverA="/inventario" />
        <main className="pag-main con-enc-sec">
          <Esqueleto filas={3} />
        </main>
      </>
    );
  }

  const cambiarPrecio = (clasificacionId: string, val: string) => {
    setPrecios((prev) => ({ ...prev, [clasificacionId]: val }));
  };

  const guardar = async () => {
    setError(null);
    if (!enLinea) {
      setError('Actualizar precios de hoy requiere conexión a internet.');
      return;
    }

    const payload: Array<{ clasificacionId: string; precio: string }> = [];
    for (const [cid, p] of Object.entries(precios)) {
      const d = D(p || 0);
      if (!d.isFinite() || d.lt(0)) {
        setError('Todos los precios deben ser números válidos mayores o iguales a cero.');
        return;
      }
      payload.push({ clasificacionId: cid, precio: d.toFixed(2) });
    }

    setGuardando(true);
    try {
      await editarPrecios(payload);
      avisar('Precios de hoy actualizados correctamente');
      navegar('/inventario', { replace: true });
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <EncabezadoSecundario titulo="Precios de hoy" volverA="/inventario" />
      <main className="pag-main con-enc-sec con-barra">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto', gap: 20 }}>
          {!enLinea && (
            <AvisoLinea tono="warn" icono={<WifiOff className="ic" />}>
              Actualizar precios del catálogo es una operación en línea.
            </AvisoLinea>
          )}

          <p className="t-aux">
            Ajusta los precios de venta para todas las clasificaciones. Los cambios aplicarán de inmediato a las nuevas ventas.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {catalogo.map((prod) => (
              <div key={prod.producto.id} className="card" style={{ padding: 14, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderBottom: '1px solid var(--borde-tenue)', paddingBottom: 6 }}>
                  <p style={{ fontWeight: 700, fontSize: 16 }}>{prod.producto.nombre}</p>
                  <span className="t-aux">Vendido por {prod.unidad.nombre}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {prod.clasificaciones.map((c) => {
                    const cid = c.clasificacion.id;
                    const precioActual = precios[cid] ?? c.clasificacion.precio;
                    const modificado = !D(precioActual || 0).eq(c.clasificacion.precio);

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
                            Precio anterior: {formatoMXN(c.clasificacion.precio)}
                            {c.clasificacion.ultimoCosto && ` · Costo: ${formatoMXN(c.clasificacion.ultimoCosto)}`}
                          </p>
                        </div>

                        <div style={{ width: 130, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: 'var(--texto-tenue)', fontWeight: 600 }}>$</span>
                          <input
                            type="number"
                            step="0.50"
                            min="0"
                            value={precioActual}
                            onChange={(e) => cambiarPrecio(cid, e.target.value)}
                            className="entrada num"
                            style={{
                              textAlign: 'right',
                              fontWeight: 700,
                              fontSize: 16,
                              borderColor: modificado ? 'var(--primario)' : undefined,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {error && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{error}</AvisoLinea>}

          <button
            type="button"
            className="btn btn-p btn-lg"
            disabled={!enLinea || guardando}
            onClick={guardar}
            style={{ marginTop: 8 }}
          >
            {guardando ? <LoaderCircle className="ic girar" /> : <Check className="ic" />}
            Guardar precios de hoy
          </button>
        </div>
      </main>
    </>
  );
}
