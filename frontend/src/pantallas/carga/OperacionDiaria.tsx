import Decimal from 'decimal.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Minus, Plus, Trash2, Truck } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import type { FormaPago } from '@micentralmx/shared/entidades';
import { useSesionActiva } from '../../auth/SesionContext';
import { AvisoLinea, Esqueleto } from '../../componentes/Estados';
import { useAvisos } from '../../componentes/Avisos';
import { useCatalogo, useClientes, useProveedores, useTotalesCargaDelDia, useCargasAbiertas } from '../../hooks/useDatosLocales';
import { registrarCarga, registrarVenta } from '../../dominio/operaciones';
import { asignarCargaRenglon } from '../../dominio/consultas';
import { diaLocal, sumarDias } from '../../lib/fechas';
import { D, formatoMXN, sumar } from '../../lib/dinero';
import { mensajeError } from '../../api/cliente';
import { useConectividad } from '../../sync/conectividad';
import './operacion-diaria.css';

interface LineaCarga {
  clasificacionId: string;
  cantidad: string;
}
interface LineaTicket extends LineaCarga {
  productoNombre: string;
  clasificacionNombre: string;
  unidadPlural: string;
  kilogramosPorUnidad: string | null;
  origenInventario: 'dia' | 'general';
  precio: string;
}

const dinero = (valor: Decimal.Value) => formatoMXN(D(valor).toString());

export default function OperacionDiaria({ soloVentas = false }: { soloVentas?: boolean }) {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const avisar = useAvisos();
  const { puede, sesion } = useSesionActiva();
  const { enLinea } = useConectividad();
  const catalogo = useCatalogo();
  const proveedores = useProveedores();
  const clientes = useClientes();
  const [fecha, setFecha] = useState(diaLocal());
  const resumen = useTotalesCargaDelDia(fecha);
  const cargasAbiertas = useCargasAbiertas() ?? [];
  const [paso, setPaso] = useState<1 | 2>(soloVentas ? 2 : 1);
  const [proveedorId, setProveedorId] = useState('');
  const [renglones, setRenglones] = useState<LineaCarga[]>([{ clasificacionId: '', cantidad: '' }]);
  const [cargaNuevaId, setCargaNuevaId] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState('1');
  const [precio, setPrecio] = useState('');
  const [ticket, setTicket] = useState<LineaTicket[]>([]);
  const [formaPago, setFormaPago] = useState<FormaPago>('efectivo');
  const [clienteId, setClienteId] = useState('');
  const [venceEl, setVenceEl] = useState(sumarDias(diaLocal(), sesion.configuracion.plazoCreditoDias));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const preseleccionAplicada = useRef(false);

  const clases = useMemo(() => (catalogo ?? []).flatMap((p) => p.clasificaciones.map((c) => ({
    id: c.clasificacion.id,
    nombre: c.clasificacion.nombre,
    productoNombre: p.producto.nombre,
    unidad: p.unidad,
    kilogramosPorUnidad: p.producto.kilogramosPorUnidad ?? null,
    precio: c.clasificacion.precio,
    existenciaCatalogo: c.existencia,
  }))), [catalogo]);
  const datosDia = resumen?.porClasificacion.map((r) => {
    const producto = catalogo?.find((p) => p.clasificaciones.some((c) => c.clasificacion.id === r.clasificacionId));
    const unidad = producto?.unidad;
    return { ...r, unidad, kilogramosPorUnidad: producto?.producto.kilogramosPorUnidad ?? null };
  }) ?? [];
  const disponiblePorUnidad = datosDia.reduce((mapa, renglon) => {
    const key = renglon.unidad?.id ?? renglon.unidadPlural;
    const actual = mapa.get(key) ?? { nombre: renglon.unidadPlural, cantidad: D(0) };
    mapa.set(key, { ...actual, cantidad: actual.cantidad.plus(renglon.queda) });
    return mapa;
  }, new Map<string, { nombre: string; cantidad: Decimal }>());
  const cargaPorUnidad = renglones.reduce((mapa, renglon) => {
    const unidad = clases.find((c) => c.id === renglon.clasificacionId)?.unidad;
    if (!unidad) return mapa;
    const actual = mapa.get(unidad.id) ?? { nombre: unidad.plural, cantidad: D(0) };
    mapa.set(unidad.id, { ...actual, cantidad: actual.cantidad.plus(renglon.cantidad || 0) });
    return mapa;
  }, new Map<string, { nombre: string; cantidad: Decimal }>());
  const totalKg = (campo: 'cargado' | 'vendido' | 'queda') => {
    if (!datosDia.length || datosDia.some((x) => !x.kilogramosPorUnidad)) return null;
    return sumar(datosDia.map((x) => x[campo].times(x.kilogramosPorUnidad!)));
  };
  const kgCargados = totalKg('cargado');
  const kgVendidos = totalKg('vendido');
  const kgQuedan = totalKg('queda');
  const indicadoresKg: Array<[string, Decimal | null]> = [['Kilos cargados', kgCargados], ['Kilos vendidos', kgVendidos], ['Kilos disponibles', kgQuedan]];
  const totalUnidadesCargaKg = renglones.filter((x) => x.clasificacionId && D(x.cantidad || 0).gt(0));
  const cargaEnKg = totalUnidadesCargaKg.length > 0 && totalUnidadesCargaKg.every((r) => clases.find((c) => c.id === r.clasificacionId)?.kilogramosPorUnidad)
    ? sumar(totalUnidadesCargaKg.map((r) => D(r.cantidad).times(clases.find((c) => c.id === r.clasificacionId)?.kilogramosPorUnidad ?? 0)))
    : null;
  const totalTicket = sumar(ticket.map((x) => D(x.cantidad).times(x.precio)));
  const puedeCambiarPrecio = puede('ventas.modificar_precio');

  const tarjetasVenta = catalogo?.flatMap((producto) => producto.clasificaciones.map((clasificacion) => {
    const dia = datosDia.find((x) => x.clasificacionId === clasificacion.clasificacion.id);
    const usaCargaDeHoy = !!dia?.queda.gt(0);
    const disponible = usaCargaDeHoy ? dia!.queda : clasificacion.existencia;
    return {
      clasificacionId: clasificacion.clasificacion.id,
      clasificacionNombre: clasificacion.clasificacion.nombre,
      productoNombre: producto.producto.nombre,
      unidad: producto.unidad,
      kilogramosPorUnidad: producto.producto.kilogramosPorUnidad ?? null,
      precio: clasificacion.clasificacion.precio,
      disponible,
      cargadoHoy: dia?.cargado ?? D(0),
      vendidoHoy: dia?.vendido ?? D(0),
      origenInventario: (usaCargaDeHoy ? 'dia' : 'general') as 'dia' | 'general',
    };
  })).filter((item) => item.disponible.gt(0)) ?? [];

  useEffect(() => {
    if (preseleccionAplicada.current || !catalogo) return;
    const clasificacionId = params.get('clasificacion');
    if (!clasificacionId) {
      preseleccionAplicada.current = true;
      return;
    }
    const producto = catalogo.find((p) => p.clasificaciones.some((c) => c.clasificacion.id === clasificacionId));
    const clasificacion = producto?.clasificaciones.find((c) => c.clasificacion.id === clasificacionId);
    if (producto && clasificacion) {
      setSeleccion(clasificacionId);
      setPrecio(clasificacion.clasificacion.precio);
    }
    preseleccionAplicada.current = true;
  }, [catalogo, params]);

  if (!catalogo || !proveedores || !clientes || !resumen) {
    return <main className="pag-main"><Esqueleto texto="Preparando operación diaria…" /></main>;
  }

  const cambiarRenglon = (indice: number, cambio: Partial<LineaCarga>) => setRenglones((actuales) => actuales.map((x, i) => i === indice ? { ...x, ...cambio } : x));
  const registrarLaCarga = async () => {
    setError(null);
    const validos = renglones.filter((r) => r.clasificacionId && D(r.cantidad || 0).gt(0));
    if (!proveedorId) return setError('Selecciona el rancho o proveedor de origen.');
    if (!validos.length) return setError('Agrega al menos una clasificación y su cantidad.');
    setGuardando(true);
    try {
      const carga = await registrarCarga({ proveedorId, fecha, renglones: validos });
      setCargaNuevaId(carga.id);
      setPaso(2);
      avisar(enLinea ? 'Carga registrada; ya puedes vender desde este inventario.' : 'Carga guardada en este dispositivo; ya puedes vender.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  const agregarAlTicket = () => {
    const clase = clases.find((x) => x.id === seleccion);
    const tarjeta = tarjetasVenta.find((x) => x.clasificacionId === seleccion);
    const existenciaDia = tarjeta?.disponible ?? D(0);
    if (!clase || !tarjeta) return setError('Elige una clasificación disponible.');
    if (!D(cantidad).gt(0)) return setError('La cantidad debe ser mayor que cero.');
    const existenteTicket = ticket.find((x) => x.clasificacionId === clase.id);
    const yaEnTicket = D(existenteTicket?.cantidad ?? 0);
    if (yaEnTicket.plus(cantidad).gt(existenciaDia)) return setError(`Solo hay ${existenciaDia.toString()} ${clase.unidad.plural} disponibles hoy.`);
    if (!puedeCambiarPrecio && !D(precio || clase.precio).eq(clase.precio)) return setError('Tu rol no permite cambiar el precio de venta.');
    setTicket((actual) => {
      const anterior = actual.find((x) => x.clasificacionId === clase.id);
      if (anterior) return actual.map((x) => x.clasificacionId === clase.id ? { ...x, cantidad: D(x.cantidad).plus(cantidad).toString() } : x);
      return [...actual, {
        clasificacionId: clase.id,
        cantidad,
        productoNombre: clase.productoNombre,
        clasificacionNombre: clase.nombre,
        unidadPlural: clase.unidad.plural,
        kilogramosPorUnidad: clase.kilogramosPorUnidad,
        origenInventario: tarjeta.origenInventario,
        precio: precio || clase.precio,
      }];
    });
    setError(null);
    setSeleccion(null);
    setCantidad('1');
    setPrecio('');
  };

  const confirmarVenta = async () => {
    setError(null);
    if (!ticket.length) return setError('Agrega productos al ticket.');
    if (formaPago === 'credito' && !clienteId) return setError('Elige el cliente para registrar la venta a crédito.');
    setGuardando(true);
    try {
      const items = [] as Array<{ clasificacionId: string; cantidad: string; precio: string; cargaId?: string | null; origenNombre?: string | null }>;
      for (const item of ticket) {
        const asignaciones = await asignarCargaRenglon(
          item.clasificacionId,
          item.cantidad,
          cargaNuevaId,
          item.origenInventario === 'dia' ? fecha : undefined,
        );
        if (!asignaciones.length || (item.origenInventario === 'dia' && asignaciones.some((a) => !a.cargaId))) throw new Error(`No hay inventario abierto suficiente de ${item.clasificacionNombre}.`);
        items.push(...asignaciones.map((a) => ({ clasificacionId: item.clasificacionId, cantidad: a.cantidad, precio: item.precio, cargaId: a.cargaId, origenNombre: a.origenNombre })));
      }
      await registrarVenta({
        renglones: items,
        clienteId: clienteId || null,
        formaPago,
        venceEl: formaPago === 'credito' ? venceEl : null,
        enLinea,
        motivoSinExistencia: null,
      });
      avisar('Venta registrada correctamente.');
      setTicket([]);
      setClienteId('');
      setFormaPago('efectivo');
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  const kilosDe = (cantidadUnidad: string, factor: string | null | undefined) => factor ? D(cantidadUnidad).times(factor).toString() : null;

  return (
    <main className="pag-main operacion-diaria">
      {!soloVentas && <>
        <header className="operacion-hero">
          <span className="operacion-eyebrow">Control diario</span>
          <h1>Carga y venta</h1>
          <p>Registra lo que llegó y vende desde tu inventario disponible.</p>
        </header>

        <nav className="operacion-pasos" aria-label="Progreso de operación">
          <button type="button" className={`operacion-paso ${paso === 1 ? 'activo' : 'hecho'}`} onClick={() => setPaso(1)}><span>{paso === 1 ? '1' : <Check size={18} />}</span>Carga del día</button>
          <button type="button" className={`operacion-paso ${paso === 2 ? 'activo' : ''}`} disabled={!datosDia.length} onClick={() => setPaso(2)}><span>2</span>Ventas</button>
        </nav>
      </>}

      {paso === 1 ? (
        <section className="operacion-panel">
          <h2>Registrar carga</h2>
          <p className="operacion-sub">Agrega los productos y unidades que recibiste hoy.</p>
          <div className="operacion-meta">
            <label className="operacion-campo">Proveedor
              <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
                <option value="">Selecciona rancho o proveedor</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
            <label className="operacion-campo">Fecha
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </label>
          </div>
          <h3 className="operacion-titulo">Productos y clasificaciones</h3>
          <div className="operacion-renglones">
            {renglones.map((r, i) => {
              const clase = clases.find((c) => c.id === r.clasificacionId);
              return <div className="operacion-renglon" key={i}>
                <label className="operacion-campo">Clasificación
                  <select value={r.clasificacionId} onChange={(e) => cambiarRenglon(i, { clasificacionId: e.target.value })}>
                    <option value="">Selecciona producto y clasificación</option>
                    {clases.map((c) => <option key={c.id} value={c.id}>{c.productoNombre} · {c.nombre}</option>)}
                  </select>
                </label>
                <label className="operacion-campo">{clase?.unidad.plural ?? 'Cantidad'}
                  <input type="number" min="0" step={clase?.unidad.permiteDecimales ? '0.01' : '1'} inputMode="decimal" placeholder="0" value={r.cantidad} onChange={(e) => cambiarRenglon(i, { cantidad: e.target.value })} />
                </label>
                <button type="button" className="operacion-icono quitar" aria-label="Quitar renglón" onClick={() => setRenglones((actuales) => actuales.length > 1 ? actuales.filter((_, j) => i !== j) : [{ clasificacionId: '', cantidad: '' }])}><Trash2 size={19} /></button>
              </div>;
            })}
          </div>
          <button type="button" className="operacion-boton suave" onClick={() => setRenglones((actuales) => [...actuales, { clasificacionId: '', cantidad: '' }])}><Plus size={19} /> Agregar clasificación</button>
          <div className="operacion-resumen"><span>Total recibido</span><strong>{[...cargaPorUnidad.values()].map((x) => `${x.cantidad.toString()} ${x.nombre}`).join(' · ') || '0'}</strong></div>
          {cargaEnKg !== null && <div className="operacion-resumen"><span>Peso total de la carga</span><strong>{cargaEnKg.toString()} kg</strong></div>}
          <p className="operacion-nota">El peso se calcula con la equivalencia configurada en Configuración → Unidades.</p>
          {error && <AvisoLinea tono="err">{error}</AvisoLinea>}
          <button type="button" className="operacion-boton principal ancho" disabled={guardando || !puede('cargas.registrar')} onClick={() => void registrarLaCarga()}>{guardando ? 'Guardando…' : 'Guardar carga y continuar'} <ArrowRight size={19} /></button>
        </section>
      ) : (
        <>
          <section className="operacion-panel">
            <div className="operacion-inventario-titulo"><div><h2>Inventario de hoy</h2><p className="operacion-sub">Toca una clasificación para preparar la venta.</p></div><span className="operacion-pill">{[...disponiblePorUnidad.values()].map((x) => `${x.cantidad.toString()} ${x.nombre}`).join(' · ')}</span></div>
            <div className="operacion-kilos">
              {indicadoresKg.map(([titulo, kg]) => <div className="operacion-kilo" key={titulo}><span>{titulo}</span><strong>{kg === null ? 'Configurar equivalencia' : `${kg.toString()} kg`}</strong></div>)}
            </div>
            <div className="operacion-productos">
              {tarjetasVenta.map((x) => (
                <button type="button" key={x.clasificacionId} className={`operacion-producto ${seleccion === x.clasificacionId ? 'seleccionado' : ''}`} onClick={() => { setSeleccion(x.clasificacionId); setCantidad('1'); setPrecio(x.precio); setError(null); }}>
                  <span><strong>{x.clasificacionNombre}</strong><small>{x.productoNombre}{x.kilogramosPorUnidad ? ` · ${x.kilogramosPorUnidad} kg por ${x.unidad.nombre}` : ''}{x.origenInventario === 'general' ? ' · inventario' : ''}</small></span>
                  <span className="operacion-stock"><b>{x.disponible.toString()}</b> {x.unidad.plural}{x.kilogramosPorUnidad && <small>{kilosDe(x.disponible.toString(), x.kilogramosPorUnidad)} kg</small>}</span>
                  <span className="operacion-mas"><Plus size={22} /></span>
                </button>
              ))}
              {tarjetasVenta.length === 0 && <p className="operacion-vacio">No hay productos con existencia disponible para vender.</p>}
            </div>
          </section>

          <div className="operacion-venta-grid">
            <section className="operacion-panel">
              <h2>Preparar venta</h2><p className="operacion-sub">Elige cantidad y ajusta el precio por unidad.</p>
              {!seleccion ? <p className="operacion-vacio">Selecciona una clasificación disponible.</p> : (() => {
                const clase = tarjetasVenta.find((c) => c.clasificacionId === seleccion)!;
                const existencia = clase?.disponible ?? D(0);
                if (!clase) return <p className="operacion-vacio">La clasificación ya no está disponible.</p>;
                return <>
                  <h3 className="operacion-titulo">{clase.clasificacionNombre}</h3>
                  <div className="operacion-control"><b>Cantidad de {clase.unidad.plural}</b><div className="operacion-cantidad"><button type="button" aria-label="Restar uno" onClick={() => setCantidad((v) => Decimal.max(0, D(v || 0).minus(1)).toString())}><Minus /></button><input type="number" min="0" step={clase.unidad.permiteDecimales ? '0.01' : '1'} value={cantidad} onChange={(e) => setCantidad(e.target.value)} /><button type="button" aria-label="Sumar uno" onClick={() => setCantidad((v) => D(v || 0).plus(1).toString())}><Plus /></button><small>{existencia.toString()} disponibles {clase.kilogramosPorUnidad ? `· ${kilosDe(existencia.toString(), clase.kilogramosPorUnidad)} kg` : ''}</small></div></div>
                  <label className="operacion-campo margen-arriba">Precio por {clase.unidad.nombre}{puedeCambiarPrecio ? '' : ' · catálogo'}
                    <input type="number" min="0" step="0.5" value={precio || clase.precio} readOnly={!puedeCambiarPrecio} onChange={(e) => setPrecio(e.target.value)} />
                  </label>
                  <button type="button" className="operacion-boton principal ancho margen-arriba" onClick={agregarAlTicket}><Plus size={18} /> Agregar al ticket</button>
                </>;
              })()}
            </section>
            <section className="operacion-panel">
              <h2>Ticket</h2><p className="operacion-sub">Puedes combinar varias clasificaciones.</p>
              {ticket.length ? ticket.map((item) => <div className="operacion-ticket-linea" key={item.clasificacionId}><span>{item.productoNombre} · {item.clasificacionNombre}<small>{item.cantidad} {item.unidadPlural} × {dinero(item.precio)}</small></span><b>{dinero(D(item.cantidad).times(item.precio))}</b><button type="button" aria-label="Quitar producto del ticket" onClick={() => setTicket((t) => t.filter((x) => x.clasificacionId !== item.clasificacionId))}><Trash2 size={17} /></button></div>) : <p className="operacion-vacio">Aún no hay productos en el ticket.</p>}
              <div className="operacion-total"><span>Total</span><strong>{dinero(totalTicket)}</strong></div>
              <label className="operacion-campo margen-arriba">Forma de pago<select value={formaPago} onChange={(e) => setFormaPago(e.target.value as FormaPago)}><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="credito">Crédito</option></select></label>
              {formaPago === 'credito' && <><label className="operacion-campo margen-arriba">Cliente<select value={clienteId} onChange={(e) => { const id = e.target.value; setClienteId(id); const cliente = clientes.find((c) => c.cliente.id === id); if (id) setVenceEl(sumarDias(diaLocal(), cliente?.cliente.plazoDias ?? sesion.configuracion.plazoCreditoDias)); }}><option value="">Selecciona cliente</option>{clientes.map((c) => <option key={c.cliente.id} value={c.cliente.id}>{c.cliente.nombre}</option>)}</select></label><label className="operacion-campo margen-arriba">Vence el<input type="date" value={venceEl} onChange={(e) => setVenceEl(e.target.value)} /></label></>}
              {error && <AvisoLinea tono="err">{error}</AvisoLinea>}
              <button type="button" className="operacion-boton principal ancho margen-arriba" disabled={guardando || !ticket.length} onClick={() => void confirmarVenta()}>{guardando ? 'Guardando…' : 'Registrar venta'} <Check size={18} /></button>
              {soloVentas
                ? <button type="button" className="operacion-boton suave ancho margen-arriba" onClick={() => navegar('/inventario')}><ArrowLeft size={18} /> Volver al inventario</button>
                : <button type="button" className="operacion-boton suave ancho margen-arriba" onClick={() => setPaso(1)}><ArrowLeft size={18} /> Ajustar carga del día</button>}
            </section>
          </div>
          {!cargasAbiertas.some((c) => c.carga.id === cargaNuevaId) && cargaNuevaId && <p className="operacion-nota">La carga se está sincronizando; las ventas quedarán ligadas al inventario disponible.</p>}
        </>
      )}
      {!soloVentas && <div className="operacion-links"><button type="button" className="operacion-link" onClick={() => navegar('/carga')}><Truck size={16} /> Volver al historial de cargas</button><button type="button" className="operacion-link" onClick={() => navegar('/carga/registro')}>Captura avanzada de carga</button></div>}
    </main>
  );
}
