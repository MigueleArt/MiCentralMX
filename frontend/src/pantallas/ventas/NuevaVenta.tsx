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
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { ElegirEnLista } from '../../componentes/ElegirEnLista';
import { AvisoLinea, Esqueleto } from '../../componentes/Estados';
import { Campo, Cantidad, EntradaImporte, Segmentado } from '../../componentes/Formulario';
import { Dialogo } from '../../componentes/Superpuestos';
import type { FormaPago } from '@micentralmx/shared/entidades';
import type { ProductoVista } from '../../dominio/consultas';
import { ErrorAlmacenamiento, ErrorValidacion } from '../../dominio/errores';
import { cantidadConUnidad } from '../../dominio/formato';
import { registrarVenta } from '../../dominio/operaciones';
import { useFormato } from '../../hooks/useFormato';
import { useCatalogo, useClientes } from '../../hooks/useDatosLocales';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN, sumar } from '../../lib/dinero';
import { diaLocal, sumarDias, textoDias, formatoDia } from '../../lib/fechas';
import { useConectividad } from '../../sync/conectividad';
import { AltaRapidaCliente } from '../clientes/FormCliente';
import { InsigniaInventario } from '../../componentes/Insignias';

interface Renglon {
  clave: number;
  productoId: string | null;
  clasificacionId: string | null;
  cantidad: string;
  precio: string;
}

const nuevoRenglon = (clave: number): Renglon => ({ clave, productoId: null, clasificacionId: null, cantidad: '1', precio: '' });

/** Pantallas 07 (Nueva venta), 32 (Error de validación), 33 (Error al guardar) y Nueva venta · PC 1440. */
export default function NuevaVenta() {
  const navegar = useNavigate();
  const formato = useFormato();
  const { sesion, puede, soloLectura } = useSesionActiva();
  const { enLinea } = useConectividad();
  const catalogo = useCatalogo();
  const clientes = useClientes();

  const [renglones, setRenglones] = useState<Renglon[]>([nuevoRenglon(1)]);
  const [activo, setActivo] = useState(1);
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
  const productoDe = (r: Renglon) => productos.find((p) => p.producto.id === r.productoId);
  const clasDe = (r: Renglon) => productoDe(r)?.clasificaciones.find((c) => c.clasificacion.id === r.clasificacionId);
  const completos = renglones.filter((r) => r.clasificacionId && D(r.cantidad || 0).gt(0));
  const total = sumar(completos.map((r) => D(r.precio || 0).times(r.cantidad || 0)));
  const cliente = clientes?.find((c) => c.cliente.id === clienteId);

  // Existencia disponible por clasificación, descontando lo pedido en los demás renglones.
  const faltantes = useMemo(() => {
    const pedido = new Map<string, Decimal>();
    for (const r of completos) pedido.set(r.clasificacionId!, (pedido.get(r.clasificacionId!) ?? D(0)).plus(r.cantidad || 0));
    const lista: Array<{ clasificacionId: string; texto: string; pedido: Decimal; disponible: Decimal }> = [];
    for (const [id, cant] of pedido) {
      const p = productos.find((x) => x.clasificaciones.some((c) => c.clasificacion.id === id));
      const c = p?.clasificaciones.find((x) => x.clasificacion.id === id);
      if (p && c && cant.gt(c.existencia)) {
        lista.push({ clasificacionId: id, pedido: cant, disponible: c.existencia, texto: `Solo hay ${cantidadConUnidad(Decimal.max(c.existencia, 0).toString(), p.unidad)} de ${c.clasificacion.nombre}.` });
      }
    }
    return lista;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renglones, catalogo]);

  const bloqueado = enLinea && faltantes.length > 0 && !puedeSinExistencia;
  const pideMotivo = enLinea && faltantes.length > 0 && puedeSinExistencia;
  const unidades = (() => {
    const porUnidad = new Map<string, { n: Decimal; u: ProductoVista['unidad'] }>();
    for (const r of completos) {
      const p = productoDe(r);
      if (!p) continue;
      const e = porUnidad.get(p.unidad.id) ?? { n: D(0), u: p.unidad };
      porUnidad.set(p.unidad.id, { ...e, n: e.n.plus(r.cantidad) });
    }
    return [...porUnidad.values()].map((x) => cantidadConUnidad(x.n.toString(), x.u)).join(' + ');
  })();

  const actualizar = (clave: number, cambio: Partial<Renglon>) => setRenglones((rs) => rs.map((r) => (r.clave === clave ? { ...r, ...cambio } : r)));
  const elegirProducto = (r: Renglon, productoId: string) => {
    const p = productos.find((x) => x.producto.id === productoId);
    const primera = p?.clasificaciones.find((c) => c.existencia.gt(0)) ?? p?.clasificaciones[0];
    actualizar(r.clave, { productoId, clasificacionId: primera?.clasificacion.id ?? null, precio: primera ? D(primera.clasificacion.precio).toString() : '' });
  };
  const agregarRenglon = () => {
    const clave = Math.max(...renglones.map((r) => r.clave)) + 1;
    setRenglones([...renglones, nuevoRenglon(clave)]);
    setActivo(clave);
  };
  const quitarRenglon = (clave: number) => {
    const resto = renglones.filter((r) => r.clave !== clave);
    setRenglones(resto.length ? resto : [nuevoRenglon(clave + 1)]);
    setActivo(resto.length ? resto[resto.length - 1].clave : clave + 1);
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
      const venta = await registrarVenta({
        renglones: completos.map((r) => ({ clasificacionId: r.clasificacionId!, cantidad: r.cantidad, precio: r.precio || '0' })),
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

  const editor = (r: Renglon, i: number) => {
    const p = productoDe(r);
    const c = clasDe(r);
    const falta = faltantes.find((f) => f.clasificacionId === r.clasificacionId);
    const idCant = `cantidad-${i}`;
    return (
      <div key={r.clave} className="pila-16">
        <section className="pila">
          <p className="step">
            <b>1</b>Producto
          </p>
          <ElegirEnLista
            id={`producto-${i}`}
            titulo="Elegir producto"
            marcador="Elegir producto"
            icono={<Package className="ic" />}
            valor={r.productoId}
            opciones={opcionesProducto}
            alElegir={(v) => elegirProducto(r, v)}
            invalido={!!errores[`renglon-${i}`] || !!errores.producto}
          />
          {(errores[`renglon-${i}`] || errores.producto) && <p className="err-msg">{errores[`renglon-${i}`] ?? errores.producto}</p>}
        </section>
        {p && (
          <>
            <section className="pila">
              <p className="step">
                <b>2</b>Clasificación
              </p>
              <div role="radiogroup" aria-label="Clasificación" className="pila">
                {p.clasificaciones.map((x) => (
                  <button
                    key={x.clasificacion.id}
                    type="button"
                    role="radio"
                    className="opt"
                    aria-checked={x.clasificacion.id === r.clasificacionId}
                    onClick={() => actualizar(r.clave, { clasificacionId: x.clasificacion.id, precio: D(x.clasificacion.precio).toString() })}
                  >
                    <span className="radio" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>{x.clasificacion.nombre}</span>
                      <span className="t-aux num" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {cantidadConUnidad(Decimal.max(x.existencia, 0).toString(), p.unidad)} disponibles
                        <InsigniaInventario bajo={x.bajo} sin={x.sinExistencia} />
                      </span>
                    </span>
                    <span className="num" style={{ fontSize: 16, fontWeight: 700 }}>
                      {formatoMXN(x.clasificacion.precio)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
            {c && (
              <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                <div className="field">
                  <label className="step" htmlFor={idCant} style={{ marginBottom: 2 }}>
                    <b>3</b>Cantidad ({p.unidad.plural})
                  </label>
                  <Cantidad
                    id={idCant}
                    valor={r.cantidad}
                    alCambiar={(v) => actualizar(r.clave, { cantidad: v })}
                    decimales={p.unidad.permiteDecimales}
                    unidad={p.unidad.nombre}
                    invalido={!!(falta && bloqueado) || !!errores[idCant]}
                    descrito={falta ? `falta-${i}` : undefined}
                  />
                </div>
                <div className="field">
                  <label className="step" htmlFor={`precio-${i}`} style={{ marginBottom: 2 }}>
                    <b>4</b>Precio por {p.unidad.nombre}
                  </label>
                  <EntradaImporte
                    id={`precio-${i}`}
                    grande
                    valor={r.precio}
                    alCambiar={(v) => actualizar(r.clave, { precio: v })}
                    readOnly={!puedePrecio}
                    error={errores[`precio-${i}`]}
                  />
                </div>
                {falta && (
                  <p id={`falta-${i}`} className="err-msg" style={{ gridColumn: '1 / -1', color: bloqueado ? undefined : 'var(--aviso-texto)' }}>
                    <CircleAlert className="ic" style={{ width: 16, height: 16 }} />
                    {falta.texto}
                    {bloqueado && ` Ingresa ${cantidadConUnidad(Decimal.max(falta.disponible, 0).toString(), p.unidad).split(' ')[0]} o menos.`}
                  </p>
                )}
                {errores[idCant] && <p className="err-msg" style={{ gridColumn: '1 / -1' }}>{errores[idCant]}</p>}
                {!puedePrecio && (
                  <p className="hint" style={{ gridColumn: '1 / -1' }}>
                    Precio de catálogo. Tu rol no permite cambiarlo.
                  </p>
                )}
                {puedePrecio && !D(r.precio || 0).eq(c.clasificacion.precio) && (
                  <p className="hint" style={{ gridColumn: '1 / -1' }}>
                    Precio de catálogo: {formatoMXN(c.clasificacion.precio)}. El cambio queda en el historial.
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    );
  };

  const resumenRenglon = (r: Renglon) => {
    const p = productoDe(r);
    const c = clasDe(r);
    if (!p || !c) return null;
    return (
      <div key={r.clave} className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={() => setActivo(r.clave)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer', color: 'inherit' }}>
          <p style={{ fontWeight: 600 }}>{p.producto.nombre}</p>
          <p className="t-aux num">
            {c.clasificacion.nombre} · {cantidadConUnidad(r.cantidad || '0', p.unidad)} × {formatoMXN(r.precio || 0)}
          </p>
        </button>
        <p className="num" style={{ fontWeight: 700 }}>
          {formatoMXN(D(r.precio || 0).times(r.cantidad || 0))}
        </p>
        <button type="button" className="icon-btn" aria-label={`Quitar ${p.producto.nombre}`} onClick={() => quitarRenglon(r.clave)}>
          <Trash2 className="ic" />
        </button>
      </div>
    );
  };

  const indiceActivo = renglones.findIndex((r) => r.clave === activo);
  const renglonActivo = renglones[indiceActivo] ?? renglones[0];
  const otros = renglones.filter((r) => r.clave !== renglonActivo.clave);
  const puedeAgregar = !!clasDe(renglonActivo) && D(renglonActivo.cantidad || 0).gt(0);
  const deshabilitado = soloLectura || guardando || completos.length === 0 || bloqueado || (pideMotivo && !motivo.trim()) || (formaPago === 'credito' && (!clienteId || !venceEl));

  const pasoCliente = (
    <section className="pila">
      <p className="step">
        <b>5</b>Cliente y forma de pago
      </p>
      <ElegirEnLista
        id="cliente"
        titulo="Cliente"
        marcador="Venta de mostrador"
        valor={clienteId ?? ''}
        opciones={[
          { valor: '', texto: 'Venta de mostrador', detalle: 'Sin cliente' },
          ...clientes.map((c) => ({ valor: c.cliente.id, texto: c.cliente.nombre, detalle: c.saldo.gt(0) ? `Saldo ${formatoMXN(c.saldo)}` : (c.cliente.telefono ?? undefined), busqueda: c.cliente.telefono ?? '' })),
        ]}
        alElegir={elegirCliente}
        invalido={!!errores.cliente}
        pie={(cerrar, q) =>
          puede('clientes.crear') && (
            <button type="button" className="btn btn-s" onClick={() => { cerrar(); setAltaCliente(q); }}>
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
          <input id="vence" className="inp" type="date" value={venceEl} min={diaLocal()} onChange={(e) => setVenceEl(e.target.value)} aria-invalid={errores.vence ? true : undefined} />
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

  const botonConfirmar = (
    <button type="button" className="btn btn-p btn-lg" style={{ flex: 1.3 }} disabled={deshabilitado} onClick={() => void confirmar()} aria-describedby={bloqueado ? 'falta-0' : undefined}>
      {guardando ? <LoaderCircle className="ic girar" /> : <Check className="ic" />}
      Confirmar venta
    </button>
  );

  const formulario = (
    <div className="pila-16" style={{ gap: 20 }}>
      {otros.length > 0 && <div className="pila">{otros.map(resumenRenglon)}</div>}
      {editor(renglonActivo, indiceActivo < 0 ? 0 : indiceActivo)}
      <button type="button" className="enlace" onClick={agregarRenglon} disabled={!puedeAgregar} style={{ alignSelf: 'flex-start', opacity: puedeAgregar ? 1 : 0.5 }}>
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
          <button type="button" className="btn btn-p" onClick={() => { setFalloGuardado(false); void confirmar(); }}>
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
        <EncabezadoSecundario titulo="Nueva venta" subtitulo={enLinea ? 'Validación de existencia en curso' : 'Sin conexión · se guardará en este dispositivo'} volverA="/ventas" />
        <main className="pag-main con-enc-sec" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 24, alignItems: 'start' }}>
          <div className="card" style={{ padding: 24 }}>{formulario}</div>
          <aside className="card" style={{ padding: 20, position: 'sticky', top: 88, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 className="t-sec">Resumen</h2>
            {completos.length === 0 && <p className="t-2">Agrega productos para ver el total.</p>}
            {completos.map((r) => {
              const p = productoDe(r)!;
              const c = clasDe(r)!;
              return (
                <div key={r.clave} className="fila-entre" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <p style={{ fontWeight: 600 }}>{p.producto.nombre}</p>
                    <p className="t-aux num">
                      {c.clasificacion.nombre} · {cantidadConUnidad(r.cantidad, p.unidad)} × {formatoMXN(r.precio || 0)}
                    </p>
                  </div>
                  <p className="num" style={{ fontWeight: 700 }}>{formatoMXN(D(r.precio || 0).times(r.cantidad))}</p>
                </div>
              );
            })}
            <dl style={{ borderTop: '1px solid var(--gris-1)' }}>
              <div className="kv">
                <dt>Cliente</dt>
                <dd>{cliente?.cliente.nombre ?? 'Mostrador'} · {formaPago === 'credito' ? 'Crédito' : formaPago === 'transferencia' ? 'Transferencia' : 'Efectivo'}</dd>
              </div>
              <div className="kv" style={{ fontSize: 18 }}>
                <dt>Total</dt>
                <dd className="num" style={{ fontSize: 24 }}>{formatoMXN(total)}</dd>
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
        <div className="contenedor-form" style={{ margin: formato === 'tablet' ? '0 auto' : undefined }}>{formulario}</div>
      </main>
      <div className="barra-accion">
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="t-aux">{bloqueado ? 'Corrige la cantidad para confirmar la venta.' : `Total${unidades ? ` · ${unidades}` : ''}`}</p>
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
