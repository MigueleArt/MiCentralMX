import Decimal from 'decimal.js';
import {
  Banknote,
  Check,
  CircleAlert,
  CreditCard,
  DatabaseZap,
  LoaderCircle,
  Package,
  Plus,
  Trash2,
  TriangleAlert,
  UserPlus,
  WifiOff,
  ArrowLeftRight,
  Layers,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { ElegirEnLista } from '../../componentes/ElegirEnLista';
import { AvisoLinea, Esqueleto } from '../../componentes/Estados';
import { Campo, Segmentado } from '../../componentes/Formulario';
import { Dialogo } from '../../componentes/Superpuestos';
import type { FormaPago } from '@micentralmx/shared/entidades';
import type { ProductoVista } from '../../dominio/consultas';
import { ErrorAlmacenamiento, ErrorValidacion } from '../../dominio/errores';
import { cantidadConUnidad } from '../../dominio/formato';
import { registrarVenta } from '../../dominio/operaciones';
import { useFormato } from '../../hooks/useFormato';
import { useCatalogo, useClientes, useCargasAbiertas } from '../../hooks/useDatosLocales';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN, sumar } from '../../lib/dinero';
import { diaLocal, sumarDias, textoDias, formatoDia } from '../../lib/fechas';
import { useConectividad } from '../../sync/conectividad';
import { AltaRapidaCliente } from '../clientes/FormCliente';
import { InsigniaInventario } from '../../componentes/Insignias';
import { asignarCargaRenglon } from '../../dominio/consultas';

interface ItemClasificacion {
  cantidad: string;
  precio: string;
  cargaId: string | null | 'auto';
}

interface BloqueProducto {
  clave: number;
  productoId: string | null;
  items: Record<string, ItemClasificacion>;
}

const nuevoBloque = (clave: number): BloqueProducto => ({ clave, productoId: null, items: {} });

export default function NuevaVenta() {
  const navegar = useNavigate();
  const formato = useFormato();
  const { sesion, puede, soloLectura } = useSesionActiva();
  const { enLinea } = useConectividad();
  const catalogo = useCatalogo();
  const clientes = useClientes();
  const cargasAbiertas = useCargasAbiertas() ?? [];

  const [bloques, setBloques] = useState<BloqueProducto[]>([nuevoBloque(1)]);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [formaPago, setFormaPago] = useState<FormaPago>('efectivo');
  const [venceEl, setVenceEl] = useState<string>('');
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [falloGuardado, setFalloGuardado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [altaCliente, setAltaCliente] = useState<string | null>(null);

  const puedePrecio = puede('ventas.modificar_precio');
  const puedeSinExistencia = puede('ventas.vender_sin_existencia');
  const productos = catalogo ?? [];
  const cliente = clientes?.find((c) => c.cliente.id === clienteId);

  // Aplanamos todas las clasificaciones que tienen cantidad > 0
  const itemsActivos = useMemo(() => {
    const lista: Array<{
      bloqueClave: number;
      producto: ProductoVista;
      clasificacionId: string;
      clasificacionNombre: string;
      cantidad: string;
      precio: string;
      cargaId: string | null | 'auto';
    }> = [];

    for (const b of bloques) {
      if (!b.productoId) continue;
      const p = productos.find((x) => x.producto.id === b.productoId);
      if (!p) continue;
      for (const c of p.clasificaciones) {
        const item = b.items[c.clasificacion.id];
        if (item && D(item.cantidad || 0).gt(0)) {
          lista.push({
            bloqueClave: b.clave,
            producto: p,
            clasificacionId: c.clasificacion.id,
            clasificacionNombre: c.clasificacion.nombre,
            cantidad: item.cantidad,
            precio: item.precio || c.clasificacion.precio,
            cargaId: item.cargaId,
          });
        }
      }
    }
    return lista;
  }, [bloques, productos]);

  const total = sumar(itemsActivos.map((r) => D(r.precio || 0).times(r.cantidad || 0)));

  // Validar existencia total disponible por clasificación
  const faltantes = useMemo(() => {
    const pedido = new Map<string, Decimal>();
    for (const r of itemsActivos) {
      pedido.set(r.clasificacionId, (pedido.get(r.clasificacionId) ?? D(0)).plus(r.cantidad || 0));
    }
    const lista: Array<{ clasificacionId: string; texto: string; pedido: Decimal; disponible: Decimal }> = [];
    for (const [id, cant] of pedido) {
      const p = productos.find((x) => x.clasificaciones.some((c) => c.clasificacion.id === id));
      const c = p?.clasificaciones.find((x) => x.clasificacion.id === id);
      if (p && c && cant.gt(c.existencia)) {
        lista.push({
          clasificacionId: id,
          pedido: cant,
          disponible: c.existencia,
          texto: `Solo hay ${cantidadConUnidad(Decimal.max(c.existencia, 0).toString(), p.unidad)} de ${c.clasificacion.nombre}.`,
        });
      }
    }
    return lista;
  }, [itemsActivos, productos]);

  const bloqueado = enLinea && faltantes.length > 0 && !puedeSinExistencia;
  const pideMotivo = enLinea && faltantes.length > 0 && puedeSinExistencia;

  const unidades = (() => {
    const porUnidad = new Map<string, { n: Decimal; u: ProductoVista['unidad'] }>();
    for (const r of itemsActivos) {
      const e = porUnidad.get(r.producto.unidad.id) ?? { n: D(0), u: r.producto.unidad };
      porUnidad.set(r.producto.unidad.id, { ...e, n: e.n.plus(r.cantidad) });
    }
    return [...porUnidad.values()].map((x) => cantidadConUnidad(x.n.toString(), x.u)).join(' + ');
  })();

  const elegirProducto = (bloqueClave: number, productoId: string) => {
    const p = productos.find((x) => x.producto.id === productoId);
    const initialItems: Record<string, ItemClasificacion> = {};
    if (p) {
      for (const c of p.clasificaciones) {
        initialItems[c.clasificacion.id] = {
          cantidad: '',
          precio: D(c.clasificacion.precio).toString(),
          cargaId: 'auto',
        };
      }
    }
    setBloques((prev) =>
      prev.map((b) => (b.clave === bloqueClave ? { ...b, productoId, items: initialItems } : b)),
    );
  };

  const actualizarItem = (
    bloqueClave: number,
    clasificacionId: string,
    cambio: Partial<ItemClasificacion>,
  ) => {
    setBloques((prev) =>
      prev.map((b) => {
        if (b.clave !== bloqueClave) return b;
        const actual = b.items[clasificacionId] ?? { cantidad: '', precio: '', cargaId: 'auto' };
        return {
          ...b,
          items: {
            ...b.items,
            [clasificacionId]: { ...actual, ...cambio },
          },
        };
      }),
    );
  };

  const agregarBloque = () => {
    const clave = Math.max(...bloques.map((b) => b.clave), 0) + 1;
    setBloques([...bloques, nuevoBloque(clave)]);
  };

  const quitarBloque = (clave: number) => {
    const resto = bloques.filter((b) => b.clave !== clave);
    setBloques(resto.length ? resto : [nuevoBloque(1)]);
  };

  const cambiarForma = (f: FormaPago) => {
    setFormaPago(f);
    if (f === 'credito' && !venceEl) {
      const plazo = cliente?.cliente.plazoDias ?? sesion.configuracion.plazoCreditoDias;
      setVenceEl(sumarDias(diaLocal(), plazo));
    }
  };

  const elegirCliente = (id: string) => {
    setClienteId(id || null);
    if (!id && formaPago === 'credito') setFormaPago('efectivo');
    if (id && formaPago === 'credito') {
      const c = clientes?.find((x) => x.cliente.id === id);
      setVenceEl(sumarDias(diaLocal(), c?.cliente.plazoDias ?? sesion.configuracion.plazoCreditoDias));
    }
  };

  const confirmar = async () => {
    setErrores({});
    setErrorGeneral(null);
    setGuardando(true);
    try {
      // Para cada item activo, asignamos a cargas (dividiendo renglón si excede la carga)
      const renglonesVenta: Array<{
        clasificacionId: string;
        cantidad: string;
        precio: string;
        cargaId?: string | null;
        origenNombre?: string | null;
      }> = [];

      for (const item of itemsActivos) {
        const preferencia = item.cargaId === 'auto' ? null : item.cargaId;
        const asignaciones = await asignarCargaRenglon(item.clasificacionId, item.cantidad, preferencia);
        if (asignaciones.length > 0) {
          for (const asig of asignaciones) {
            renglonesVenta.push({
              clasificacionId: item.clasificacionId,
              cantidad: asig.cantidad,
              precio: item.precio || '0',
              cargaId: asig.cargaId,
              origenNombre: asig.origenNombre,
            });
          }
        } else {
          renglonesVenta.push({
            clasificacionId: item.clasificacionId,
            cantidad: item.cantidad,
            precio: item.precio || '0',
          });
        }
      }

      const venta = await registrarVenta({
        renglones: renglonesVenta,
        clienteId,
        formaPago,
        venceEl: formaPago === 'credito' ? venceEl : null,
        enLinea,
        motivoSinExistencia: pideMotivo ? motivo : null,
      });
      navegar(`/ventas/${venta.id}/registrada`, { replace: true, state: { sinConexion: !enLinea } });
    } catch (e) {
      if (e instanceof ErrorAlmacenamiento) setFalloGuardado(true);
      else if (e instanceof ErrorValidacion && e.campo) setErrores({ [e.campo]: e.message });
      else setErrorGeneral(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  if (!catalogo || !clientes) {
    return (
      <>
        <EncabezadoSecundario titulo="Nueva venta" cerrar volverA="/ventas" />
        <main className="pag-main con-enc-sec">
          <Esqueleto filas={3} />
        </main>
      </>
    );
  }

  const opcionesProducto = productos
    .filter((p) => p.clasificaciones.length > 0)
    .map((p) => ({
      valor: p.producto.id,
      texto: p.producto.nombre,
      detalle: `${cantidadConUnidad(p.total.toString(), p.unidad)} en total · por ${p.unidad.nombre}`,
    }));

  const renderBloque = (bloque: BloqueProducto, index: number) => {
    const p = productos.find((x) => x.producto.id === bloque.productoId);

    return (
      <div
        key={bloque.clave}
        className="card"
        style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div className="fila-entre" style={{ alignItems: 'center' }}>
          <p className="step" style={{ margin: 0 }}>
            <b>1</b>Producto {bloques.length > 1 ? `#${index + 1}` : ''}
          </p>
          {bloques.length > 1 && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => quitarBloque(bloque.clave)}
              aria-label="Quitar producto"
            >
              <Trash2 className="ic" />
            </button>
          )}
        </div>

        <ElegirEnLista
          id={`producto-${bloque.clave}`}
          titulo="Elegir producto"
          marcador="Elegir producto"
          icono={<Package className="ic" />}
          valor={bloque.productoId}
          opciones={opcionesProducto}
          alElegir={(v) => elegirProducto(bloque.clave, v)}
        />

        {p && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p className="lbl" style={{ marginBottom: 4 }}>
              Clasificaciones, origen y precios
            </p>

            {p.clasificaciones.map((c) => {
              const cid = c.clasificacion.id;
              const item = bloque.items[cid] ?? {
                cantidad: '',
                precio: D(c.clasificacion.precio).toString(),
                cargaId: 'auto',
              };

              // Cargas abiertas con existencia para esta clasificación
              const cargasConStock = cargasAbiertas.filter((ca) =>
                (ca.existencias.get(cid) ?? D(0)).gt(0),
              );

              // Resolver origen seleccionado
              let origenTexto = 'Inventario general';
              if (item.cargaId === 'auto') {
                if (cargasConStock.length > 0) {
                  const masAntigua = cargasConStock[0];
                  const disp = masAntigua.existencias.get(cid) ?? D(0);
                  origenTexto = `${masAntigua.proveedorNombre} (${disp.toString()} disp.)`;
                }
              } else if (item.cargaId === null) {
                origenTexto = 'Inventario general';
              } else {
                const elegida = cargasConStock.find((ca) => ca.carga.id === item.cargaId);
                if (elegida) {
                  const disp = elegida.existencias.get(cid) ?? D(0);
                  origenTexto = `${elegida.proveedorNombre} (${disp.toString()} disp.)`;
                }
              }

              const falta = faltantes.find((f) => f.clasificacionId === cid);

              return (
                <div
                  key={cid}
                  style={{
                    padding: 12,
                    background: 'var(--fondo-control)',
                    borderRadius: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontWeight: 600, fontSize: 15 }}>{c.clasificacion.nombre}</p>
                      <div className="t-aux" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>Disp: {cantidadConUnidad(c.existencia.toString(), p.unidad)}</span>
                        <InsigniaInventario bajo={c.bajo} sin={c.sinExistencia} />
                      </div>
                    </div>
                  </div>

                  {/* Origen de la carga */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, background: 'var(--fondo-elevado)', padding: '6px 10px', borderRadius: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Layers className="ic" style={{ width: 14, height: 14, color: 'var(--primario)' }} />
                      <span>
                        De: <strong>{origenTexto}</strong>
                      </span>
                    </div>

                    {cargasConStock.length > 0 && (
                      <select
                        aria-label={`Cambiar origen de ${c.clasificacion.nombre}`}
                        value={item.cargaId === 'auto' ? 'auto' : (item.cargaId ?? 'general')}
                        onChange={(e) => {
                          const val = e.target.value;
                          actualizarItem(bloque.clave, cid, {
                            cargaId: val === 'auto' ? 'auto' : val === 'general' ? null : val,
                          });
                        }}
                        style={{
                          fontSize: 12,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'var(--fondo)',
                          border: '1px solid var(--borde)',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="auto">Automático (más antigua con stock)</option>
                        {cargasConStock.map((cg) => (
                          <option key={cg.carga.id} value={cg.carga.id}>
                            {cg.proveedorNombre} ({cg.existencias.get(cid)?.toString()} disp.)
                          </option>
                        ))}
                        <option value="general">Inventario general (sin carga)</option>
                      </select>
                    )}
                  </div>

                  {/* Campos de Cantidad y Precio */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 2 }}>
                        Cantidad ({p.unidad.plural})
                      </label>
                      <input
                        type="number"
                        aria-label={`Cantidad ${c.clasificacion.nombre}`}
                        step={p.unidad.permiteDecimales ? '0.01' : '1'}
                        min="0"
                        placeholder="0"
                        value={item.cantidad}
                        onChange={(e) => actualizarItem(bloque.clave, cid, { cantidad: e.target.value })}
                        className="entrada num"
                        style={{
                          width: '100%',
                          fontWeight: 700,
                          fontSize: 16,
                          textAlign: 'right',
                          borderColor: falta && bloqueado ? 'var(--error)' : undefined,
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 2 }}>
                        Precio por {p.unidad.nombre}
                      </label>
                      <input
                        type="number"
                        step="0.50"
                        min="0"
                        value={item.precio}
                        readOnly={!puedePrecio}
                        onChange={(e) => actualizarItem(bloque.clave, cid, { precio: e.target.value })}
                        className="entrada num"
                        style={{
                          width: '100%',
                          fontWeight: 700,
                          fontSize: 16,
                          textAlign: 'right',
                        }}
                      />
                    </div>
                  </div>

                  {falta && (
                    <p className="err-msg" style={{ fontSize: 12, color: bloqueado ? undefined : 'var(--aviso-texto)' }}>
                      <CircleAlert className="ic" style={{ width: 14, height: 14 }} />
                      {falta.texto}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const pasoCliente = (
    <section className="pila">
      <p className="step">
        <b>2</b>Cliente y forma de pago
      </p>
      <ElegirEnLista
        id="cliente"
        titulo="Cliente"
        marcador="Venta de mostrador"
        valor={clienteId ?? ''}
        opciones={[
          { valor: '', texto: 'Venta de mostrador', detalle: 'Sin cliente' },
          ...clientes.map((c) => ({
            valor: c.cliente.id,
            texto: c.cliente.nombre,
            detalle: c.saldo.gt(0) ? `Saldo ${formatoMXN(c.saldo)}` : c.cliente.telefono ?? undefined,
            busqueda: c.cliente.telefono ?? '',
          })),
        ]}
        alElegir={elegirCliente}
        invalido={!!errores.cliente}
        pie={(cerrar, q) =>
          puede('clientes.crear') && (
            <button
              type="button"
              className="btn btn-s"
              onClick={() => {
                cerrar();
                setAltaCliente(q);
              }}
            >
              <UserPlus className="ic" />
              Agregar cliente
            </button>
          )
        }
      />
      {errores.cliente && <p className="err-msg">{errores.cliente}</p>}
      <Segmentado<FormaPago>
        etiqueta="Forma de pago"
        valor={formaPago}
        alCambiar={cambiarForma}
        opciones={[
          { valor: 'efectivo', texto: 'Efectivo', icono: <Banknote className="ic" /> },
          { valor: 'transferencia', texto: 'Transferencia', icono: <ArrowLeftRight className="ic" /> },
          { valor: 'credito', texto: 'Crédito', icono: <CreditCard className="ic" />, deshabilitado: !clienteId },
        ]}
      />
      {!clienteId && <p className="hint">Elige un cliente para registrarla a crédito.</p>}
      {formaPago === 'transferencia' && <p className="hint">Quedará “Por confirmar” hasta verificar la transferencia.</p>}
      {formaPago === 'credito' && (
        <Campo etiqueta="Vence" id="vence" error={errores.vence} ayuda={venceEl ? `${formatoDia(venceEl)} · ${textoDias(venceEl)}` : undefined}>
          <input
            id="vence"
            className="inp"
            type="date"
            value={venceEl}
            min={diaLocal()}
            onChange={(e) => setVenceEl(e.target.value)}
            aria-invalid={errores.vence ? true : undefined}
          />
        </Campo>
      )}
    </section>
  );

  const avisos = (
    <>
      {!enLinea && faltantes.length > 0 && (
        <AvisoLinea tono="warn" icono={<WifiOff className="ic" />}>
          <strong>Sin conexión: la existencia puede no estar al día</strong>
          Se registrará la venta. Si al sincronizar no alcanza, quedará en revisión.
        </AvisoLinea>
      )}
      {pideMotivo && (
        <AvisoLinea tono="warn" icono={<TriangleAlert className="ic" />}>
          <strong>Vas a vender más de lo que hay</strong>
          La venta quedará en revisión. Indica el motivo.
          <textarea
            className="inp"
            style={{ marginTop: 8, minHeight: 64 }}
            aria-label="Motivo para vender sin existencia"
            placeholder="Ej. La mercancía llegó y falta registrar la compra"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </AvisoLinea>
      )}
      {errores.motivo && <p className="err-msg">{errores.motivo}</p>}
      {errores.existencia && <p className="err-msg">{errores.existencia}</p>}
      {errorGeneral && (
        <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>
          {errorGeneral}
        </AvisoLinea>
      )}
    </>
  );

  const deshabilitado =
    soloLectura ||
    guardando ||
    itemsActivos.length === 0 ||
    bloqueado ||
    (pideMotivo && !motivo.trim()) ||
    (formaPago === 'credito' && (!clienteId || !venceEl));

  const botonConfirmar = (
    <button
      type="button"
      className="btn btn-p btn-lg"
      style={{ flex: 1.3 }}
      disabled={deshabilitado}
      onClick={() => void confirmar()}
    >
      {guardando ? <LoaderCircle className="ic girar" /> : <Check className="ic" />}
      Confirmar venta
    </button>
  );

  const formulario = (
    <div className="pila-16" style={{ gap: 20 }}>
      {bloques.map((b, i) => renderBloque(b, i))}
      <button
        type="button"
        className="btn btn-q"
        onClick={agregarBloque}
        style={{ alignSelf: 'flex-start' }}
      >
        <Plus className="ic" />
        Agregar otro producto
      </button>
      {pasoCliente}
      {avisos}
    </div>
  );

  const falloDialogo = falloGuardado && (
    <Dialogo
      titulo="No se pudo guardar en este dispositivo"
      tono="peligro"
      icono={<DatabaseZap className="ic" />}
      alCerrar={() => setFalloGuardado(false)}
      acciones={
        <>
          <button
            type="button"
            className="btn btn-p"
            onClick={() => {
              setFalloGuardado(false);
              void confirmar();
            }}
          >
            Intentar nuevamente
          </button>
          <button type="button" className="btn btn-q" onClick={() => navegar('/ventas')}>
            Cancelar
          </button>
        </>
      }
    >
      <p className="t-2" style={{ fontSize: 15 }}>
        El almacenamiento del navegador no respondió; puede estar lleno. Tus datos siguen en el formulario.
      </p>
    </Dialogo>
  );

  const altaDialogo = altaCliente !== null && (
    <AltaRapidaCliente
      nombreInicial={altaCliente}
      alCerrar={() => setAltaCliente(null)}
      alCrear={(c) => {
        setAltaCliente(null);
        setClienteId(c.id);
      }}
    />
  );

  if (formato === 'pc') {
    return (
      <>
        <EncabezadoSecundario
          titulo="Nueva venta"
          subtitulo={enLinea ? 'Validación de existencia en curso' : 'Sin conexión · se guardará en este dispositivo'}
          volverA="/ventas"
        />
        <main
          className="pag-main con-enc-sec"
          style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 24, alignItems: 'start' }}
        >
          <div className="card" style={{ padding: 24 }}>
            {formulario}
          </div>
          <aside
            className="card"
            style={{ padding: 20, position: 'sticky', top: 88, display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <h2 className="t-sec">Resumen</h2>
            {itemsActivos.length === 0 && <p className="t-2">Agrega cantidades para ver el total.</p>}
            {itemsActivos.map((r, idx) => (
              <div key={`${r.clasificacionId}-${idx}`} className="fila-entre" style={{ alignItems: 'flex-start' }}>
                <div>
                  <p style={{ fontWeight: 600 }}>{r.producto.producto.nombre}</p>
                  <p className="t-aux num">
                    {r.clasificacionNombre} · {cantidadConUnidad(r.cantidad, r.producto.unidad)} × {formatoMXN(r.precio || 0)}
                  </p>
                </div>
                <p className="num" style={{ fontWeight: 700 }}>
                  {formatoMXN(D(r.precio || 0).times(r.cantidad))}
                </p>
              </div>
            ))}
            <dl style={{ borderTop: '1px solid var(--gris-1)' }}>
              <div className="kv">
                <dt>Cliente</dt>
                <dd>
                  {cliente?.cliente.nombre ?? 'Mostrador'} ·{' '}
                  {formaPago === 'credito' ? 'Crédito' : formaPago === 'transferencia' ? 'Transferencia' : 'Efectivo'}
                </dd>
              </div>
              <div className="kv" style={{ fontSize: 18 }}>
                <dt>Total</dt>
                <dd className="num" style={{ fontSize: 24 }}>
                  {formatoMXN(total)}
                </dd>
              </div>
            </dl>
            {bloqueado && (
              <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>
                <strong>Revisa la cantidad</strong>
                {faltantes[0].texto} Ajusta la cantidad para confirmar.
              </AvisoLinea>
            )}
            {botonConfirmar}
            <button type="button" className="btn btn-q" onClick={() => navegar('/ventas')}>
              Cancelar
            </button>
          </aside>
        </main>
        {falloDialogo}
        {altaDialogo}
      </>
    );
  }

  return (
    <>
      <EncabezadoSecundario titulo="Nueva venta" cerrar volverA="/ventas" />
      <main className="pag-main con-enc-sec con-barra">
        <div className="contenedor-form" style={{ margin: formato === 'tablet' ? '0 auto' : undefined }}>
          {formulario}
        </div>
      </main>
      <div className="barra-accion">
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="t-aux">
            {bloqueado ? 'Corrige la cantidad para confirmar la venta.' : `Total${unidades ? ` · ${unidades}` : ''}`}
          </p>
          <p className="num" style={{ fontSize: 24, fontWeight: 700, lineHeight: '30px' }}>
            {formatoMXN(total)}
          </p>
        </div>
        {botonConfirmar}
      </div>
      {falloDialogo}
      {altaDialogo}
    </>
  );
}
