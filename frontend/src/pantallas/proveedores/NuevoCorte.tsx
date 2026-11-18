import { useLiveQuery } from 'dexie-react-hooks';
import {
  Calculator,
  Coins,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, mensajeError } from '../../api/cliente';
import { useAvisos } from '../../componentes/Avisos';
import { ElegirEnLista } from '../../componentes/ElegirEnLista';
import { AvisoLinea, Esqueleto } from '../../componentes/Estados';
import { Campo, Entrada, EntradaImporte, Segmentado } from '../../componentes/Formulario';
import { db } from '../../db/db';
import { emitirLiquidacion } from '../../dominio/operaciones';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { aImporte, D, formatoCantidad, formatoMXN, sumar } from '../../lib/dinero';
import { diaLocal } from '../../lib/fechas';
import { useConectividad } from '../../sync/conectividad';
import type { ComisionTipo, ComisionTipoBase } from '@micentralmx/shared/entidades';

interface VentaPendienteApi {
  cargaId: string;
  cargaFecha: string;
  ventaId: string;
  folio: number | null;
  linea: number;
  importe: string;
  cantidad: string;
  productoNombre: string;
  clasificacionNombre: string;
  creadaEn: string;
}

interface CargaInfoApi {
  id: string;
  fecha: string;
  comisionTipo: ComisionTipoBase;
  comisionValor: string | null;
}

interface MermaSugeridaApi {
  id: string;
  cargaId: string | null;
  productoNombre?: string;
  clasificacionNombre: string;
  cantidad: string;
  motivo?: string;
  montoSugerido?: string;
  creadoEn?: string;
}

interface DescuentoItem {
  tipo: 'flete' | 'tara' | 'merma' | 'otro';
  concepto: string;
  monto: string;
  movimientoId?: string | null;
}

export default function NuevoCorte() {
  const { id: provIdParam } = useParams();
  const navegar = useNavigate();
  const avisar = useAvisos();
  const { enLinea } = useConectividad();

  const proveedores = useLiveQuery(async () => {
    const todos = await db.proveedores.toArray();
    return todos.filter((p) => p.tipo !== 'rancho_propio' && !p.archivadoEn);
  });

  const [proveedorId, setProveedorId] = useState<string>(provIdParam ?? '');
  const [cargando, setCargando] = useState(false);
  const [datosPendientes, setDatosPendientes] = useState<{
    ventasPendientes: VentaPendienteApi[];
    cargas: CargaInfoApi[];
    proveedor: { id: string; nombre: string; comisionTipo: ComisionTipoBase; comisionValor: string | null };
    anticiposEntregados: string;
    mermasSugeridas: MermaSugeridaApi[];
  } | null>(null);

  const [filtroPeriodo, setFiltroPeriodo] = useState<'todo' | 'semana' | 'quincena' | 'mes'>('todo');
  const [renglonesSeleccionados, setRenglonesSeleccionados] = useState<Set<string>>(new Set());

  // Comisión
  const [comisionTipo, setComisionTipo] = useState<ComisionTipo>('porcentaje');
  const [comisionValor, setComisionValor] = useState<string>('');
  const [comisionFinal, setComisionFinal] = useState<string>('');
  const [comisionNota, setComisionNota] = useState<string>('');

  // Descuentos
  const [descuentos, setDescuentos] = useState<DescuentoItem[]>([]);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cargar datos pendientes de la API
  useEffect(() => {
    if (!proveedorId || !enLinea) return;
    setCargando(true);
    setError(null);

    api<any>('GET', `/liquidaciones/pendientes?proveedorId=${proveedorId}`)
      .then((res) => {
        const ventas = (res.ventasPendientes ?? res.renglones ?? []) as VentaPendienteApi[];
        const mermas = (res.mermasSugeridas ?? res.mermas ?? []) as MermaSugeridaApi[];
        setDatosPendientes({
          ...res,
          ventasPendientes: ventas,
          mermasSugeridas: mermas,
        });
        // Pre-seleccionar todos
        const keys = new Set<string>();
        for (const v of ventas) {
          keys.add(`${v.ventaId}:${v.linea}`);
        }
        setRenglonesSeleccionados(keys);

        // Comisión inicial
        const cTipo = res.proveedor.comisionTipo ?? 'porcentaje';
        const cVal = res.proveedor.comisionValor ?? '';
        setComisionTipo(cTipo);
        setComisionValor(cVal);
      })
      .catch((err) => setError(mensajeError(err)))
      .finally(() => setCargando(false));
  }, [proveedorId, enLinea]);

  // Filtrar según atajo de período
  const filtrarPorPeriodo = (items: VentaPendienteApi[], periodo: 'todo' | 'semana' | 'quincena' | 'mes') => {
    if (periodo === 'todo') return items;
    const hoy = new Date();
    const hoyIso = diaLocal();

    return items.filter((item) => {
      const f = item.creadaEn.slice(0, 10);
      if (periodo === 'semana') {
        const diaSemana = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1; // 0=Lunes
        const lunes = new Date(hoy);
        lunes.setDate(hoy.getDate() - diaSemana);
        const lunesIso = lunes.toISOString().slice(0, 10);
        return f >= lunesIso && f <= hoyIso;
      }
      if (periodo === 'quincena') {
        const d = hoy.getDate();
        const añoMes = hoyIso.slice(0, 8);
        const desde = d <= 15 ? `${añoMes}01` : `${añoMes}16`;
        return f >= desde && f <= hoyIso;
      }
      if (periodo === 'mes') {
        const añoMes = hoyIso.slice(0, 7);
        return f.startsWith(añoMes);
      }
      return true;
    });
  };

  const ventasDisponibles = filtrarPorPeriodo(datosPendientes?.ventasPendientes ?? [], filtroPeriodo);

  // Selección
  const toggleSeleccion = (clave: string) => {
    const copia = new Set(renglonesSeleccionados);
    if (copia.has(clave)) copia.delete(clave);
    else copia.add(clave);
    setRenglonesSeleccionados(copia);
  };

  const seleccionarTodos = () => {
    const keys = new Set<string>();
    for (const v of ventasDisponibles) keys.add(`${v.ventaId}:${v.linea}`);
    setRenglonesSeleccionados(keys);
  };

  const deseleccionarTodos = () => {
    setRenglonesSeleccionados(new Set());
  };

  // Cálculo de totales
  const renglonesElegidos = (datosPendientes?.ventasPendientes ?? []).filter((v) =>
    renglonesSeleccionados.has(`${v.ventaId}:${v.linea}`),
  );

  const totalVendido = sumar(renglonesElegidos.map((r) => r.importe));
  const unidadesVendidas = sumar(renglonesElegidos.map((r) => r.cantidad));

  // Cálculo de comisión sugerida (respetando sobreescrituras por carga)
  const cargasMap = new Map((datosPendientes?.cargas ?? []).map((c) => [c.id, c]));

  let comisionCalculada = D(0);
  for (const r of renglonesElegidos) {
    const carga = cargasMap.get(r.cargaId);
    const tipo = carga?.comisionTipo ?? comisionTipo;
    const val = carga?.comisionValor ? D(carga.comisionValor) : comisionValor ? D(comisionValor) : D(0);

    if (tipo === 'porcentaje') {
      comisionCalculada = comisionCalculada.plus(D(r.importe).times(val).div(100));
    } else if (tipo === 'por_unidad') {
      comisionCalculada = comisionCalculada.plus(D(r.cantidad).times(val));
    }
  }

  // Si el usuario no ha puesto comisionFinal manual, sugerimos la calculada
  const comisionFinalEfectiva = comisionFinal !== '' ? D(comisionFinal || 0) : comisionCalculada;
  const difiereComision = !comisionFinalEfectiva.equals(comisionCalculada);

  // Descuentos
  const totalDescuentos = sumar(descuentos.map((d) => d.monto || 0));
  const neto = totalVendido.minus(comisionFinalEfectiva).minus(totalDescuentos);

  // Agregar descuento
  const agregarDescuento = (
    tipo: 'flete' | 'tara' | 'merma' | 'otro',
    concepto = '',
    monto = '',
    movimientoId?: string | null,
  ) => {
    setDescuentos([...descuentos, { tipo, concepto, monto, movimientoId }]);
  };

  const quitarDescuento = (index: number) => {
    setDescuentos(descuentos.filter((_, i) => i !== index));
  };

  const actualizarDescuento = (index: number, campo: keyof DescuentoItem, valor: string) => {
    const copia = [...descuentos];
    copia[index] = { ...copia[index], [campo]: valor };
    setDescuentos(copia);
  };

  // Emitir liquidación
  const emitir = async () => {
    if (renglonesElegidos.length === 0) {
      setError('Debes incluir al menos un renglón de venta en el corte.');
      return;
    }
    if (comisionFinalEfectiva.lt(0) || comisionFinalEfectiva.gt(totalVendido)) {
      setError('La comisión final debe ser mayor o igual a 0 y menor o igual al total vendido.');
      return;
    }
    if (difiereComision && !comisionNota.trim()) {
      setError('Escribe una nota obligatoria explicando por qué la comisión final difiere de la calculada.');
      return;
    }

    setGuardando(true);
    setError(null);

    const payload = {
      proveedorId,
      periodoDesde: null,
      periodoHasta: null,
      comisionTipo,
      comisionValor: comisionValor || null,
      comisionFinal: aImporte(comisionFinalEfectiva),
      comisionNota: comisionNota.trim() || null,
      renglones: renglonesElegidos.map((r) => ({
        ventaId: r.ventaId,
        linea: r.linea,
        cargaId: r.cargaId,
        importe: r.importe,
      })),
      conceptos: descuentos
        .filter((d) => D(d.monto || 0).gt(0))
        .map((d) => ({
          tipo: d.tipo,
          concepto: d.concepto.trim() || d.tipo.toUpperCase(),
          monto: aImporte(d.monto),
          movimientoId: d.tipo === 'merma' ? (d.movimientoId ?? null) : null,
        })),
    };

    try {
      const res = await emitirLiquidacion(payload);
      avisar(`Corte emitido exitosamente por ${formatoMXN(res.liquidacion.neto)}`);
      navegar(`/proveedores/${proveedorId}`, { replace: true });
    } catch (err) {
      setError(mensajeError(err));
      setGuardando(false);
    }
  };

  return (
    <>
      <EncabezadoSecundario titulo="Nuevo corte a productor" volverA={`/proveedores/${proveedorId || ''}`} />

      <main className="pag-main con-enc-sec con-barra">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto' }}>
          {!enLinea && (
            <AvisoLinea tono="warn" icono={<WifiOff className="ic" />}>
              Emitir cortes requiere conexión a internet para asegurar la inmutabilidad y los folios.
            </AvisoLinea>
          )}

          {/* Selector de Productor si no vino fijo */}
          <Campo etiqueta="Productor" id="prov">
            <ElegirEnLista
              id="prov"
              titulo="Productor"
              marcador="Elige el productor"
              valor={proveedorId}
              opciones={(proveedores ?? []).map((p) => ({ valor: p.id, texto: p.nombre }))}
              alElegir={(v) => {
                setProveedorId(v);
                setDatosPendientes(null);
              }}
            />
          </Campo>

          {cargando && <Esqueleto filas={3} />}

          {proveedorId && !cargando && datosPendientes && (
            <>
              {/* Anticipos entregados acumulados (informativo) */}
              {D(datosPendientes.anticiposEntregados).gt(0) && (
                <div
                  className="card"
                  style={{
                    padding: 12,
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <Coins className="ic" style={{ color: '#2563eb' }} />
                  <div>
                    <p style={{ fontWeight: 600, fontSize: 13, color: '#1e40af' }}>
                      Anticipos acumulados: {formatoMXN(datosPendientes.anticiposEntregados)}
                    </p>
                    <p className="t-aux" style={{ fontSize: 12, color: '#3b82f6' }}>
                      Dato informativo. Los anticipos reducen el saldo del estado de cuenta, no se restan del neto del corte.
                    </p>
                  </div>
                </div>
              )}

              {/* Atajos de período */}
              <div className="card pila-12" style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <p style={{ fontWeight: 600, fontSize: 14 }}>Período a liquidar</p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-s btn-sm" onClick={seleccionarTodos}>
                      Todos
                    </button>
                    <button type="button" className="btn btn-q btn-sm" onClick={deseleccionarTodos}>
                      Ninguno
                    </button>
                  </div>
                </div>
                <Segmentado<'todo' | 'semana' | 'quincena' | 'mes'>
                  etiqueta="Atajos"
                  valor={filtroPeriodo}
                  alCambiar={setFiltroPeriodo}
                  opciones={[
                    { valor: 'todo', texto: 'Todo lo pendiente' },
                    { valor: 'semana', texto: 'Esta semana' },
                    { valor: 'quincena', texto: 'Esta quincena' },
                    { valor: 'mes', texto: 'Este mes' },
                  ]}
                />
              </div>

              {/* Ventas pendientes agrupadas por carga */}
              <div className="card pila-12" style={{ padding: 12 }}>
                <p style={{ fontWeight: 600, fontSize: 14 }}>
                  Ventas pendientes seleccionadas ({renglonesElegidos.length} de {datosPendientes.ventasPendientes.length})
                </p>

                {ventasDisponibles.length === 0 ? (
                  <p className="t-aux" style={{ textAlign: 'center', padding: '16px 0' }}>
                    No hay ventas pendientes de cortar en este período.
                  </p>
                ) : (
                  <div className="pila-12" style={{ maxHeight: 300, overflowY: 'auto' }}>
                    {ventasDisponibles.map((v) => {
                      const clave = `${v.ventaId}:${v.linea}`;
                      const sel = renglonesSeleccionados.has(clave);

                      return (
                        <div
                          key={clave}
                          onClick={() => toggleSeleccion(clave)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 10px',
                            borderRadius: 6,
                            background: sel ? 'var(--primario-fondo, #eff6ff)' : 'var(--fondo-superficie, #f9fafb)',
                            cursor: 'pointer',
                            border: sel ? '1px solid var(--primario)' : '1px solid transparent',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="checkbox" checked={sel} readOnly style={{ pointerEvents: 'none' }} />
                            <div>
                              <p style={{ fontWeight: 600, fontSize: 13 }}>
                                {v.productoNombre} · {v.clasificacionNombre}
                              </p>
                              <p className="t-aux" style={{ fontSize: 11 }}>
                                Venta #{v.folio ?? '—'} · Carga {v.cargaFecha} · {formatoCantidad(v.cantidad)} unid.
                              </p>
                            </div>
                          </div>
                          <p className="num" style={{ fontWeight: 600, fontSize: 14 }}>
                            {formatoMXN(v.importe)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingTop: 8,
                    borderTop: '1px solid var(--borde)',
                  }}
                >
                  <span className="t-aux">Total vendido ({formatoCantidad(unidadesVendidas)} unid.):</span>
                  <strong className="num" style={{ fontSize: 16 }}>{formatoMXN(totalVendido)}</strong>
                </div>
              </div>

              {/* Configuración de Comisión */}
              <div className="card pila-12" style={{ padding: 12 }}>
                <p style={{ fontWeight: 600, fontSize: 14 }}>Comisión</p>
                <div style={{ display: 'flex', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="comisionTipo"
                      checked={comisionTipo === 'porcentaje'}
                      onChange={() => setComisionTipo('porcentaje')}
                    />
                    Porcentaje (%)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="comisionTipo"
                      checked={comisionTipo === 'por_unidad'}
                      onChange={() => setComisionTipo('por_unidad')}
                    />
                    Por unidad ($/unid)
                  </label>
                </div>

                <Campo
                  etiqueta={comisionTipo === 'porcentaje' ? 'Tasa sugerida (%)' : 'Monto sugerido por unidad ($)'}
                  id="com-val"
                >
                  <Entrada
                    id="com-val"
                    type="number"
                    step="any"
                    value={comisionValor}
                    onChange={(e) => setComisionValor(e.target.value)}
                    placeholder="0"
                  />
                </Campo>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="t-aux">Comisión calculada sugerida:</span>
                  <span className="num" style={{ fontWeight: 600 }}>{formatoMXN(comisionCalculada)}</span>
                </div>

                <Campo etiqueta="Comisión final a cobrar ($)" id="com-fin" opcional>
                  <EntradaImporte
                    id="com-fin"
                    valor={comisionFinal !== '' ? comisionFinal : aImporte(comisionCalculada)}
                    alCambiar={setComisionFinal}
                    placeholder={aImporte(comisionCalculada)}
                  />
                </Campo>

                {difiereComision && (
                  <Campo etiqueta="Nota obligatoria (por qué difiere la comisión)" id="com-nota">
                    <Entrada
                      id="com-nota"
                      value={comisionNota}
                      onChange={(e) => setComisionNota(e.target.value)}
                      placeholder="Ej. Se acordó descuento en la comisión por volumen"
                    />
                  </Campo>
                )}
              </div>

              {/* Descuentos agregables */}
              <div className="card pila-12" style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <p style={{ fontWeight: 600, fontSize: 14 }}>Descuentos aplicados al corte</p>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-s btn-sm"
                      onClick={() => agregarDescuento('flete', 'Flete de mercancía')}
                    >
                      + Flete
                    </button>
                    <button
                      type="button"
                      className="btn btn-s btn-sm"
                      onClick={() => agregarDescuento('tara', 'Cobro de taras')}
                    >
                      + Tara
                    </button>
                    <button
                      type="button"
                      className="btn btn-s btn-sm"
                      onClick={() => agregarDescuento('otro', 'Otro concepto')}
                    >
                      + Otro
                    </button>
                  </div>
                </div>

                {/* Sugerencias de mermas pendientes */}
                {datosPendientes.mermasSugeridas.length > 0 && (
                  <div style={{ background: '#fffbeb', padding: 10, borderRadius: 6, border: '1px solid #fef3c7' }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
                      Mermas de estas cargas sin cobrar ({datosPendientes.mermasSugeridas.length}):
                    </p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {datosPendientes.mermasSugeridas.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className="btn btn-q btn-sm"
                          style={{ fontSize: 11, background: '#fff' }}
                          onClick={() =>
                            agregarDescuento(
                              'merma',
                              `Merma ${m.clasificacionNombre} (${formatoCantidad(m.cantidad)})`,
                              m.montoSugerido ?? '',
                              m.id,
                            )
                          }
                        >
                          + {m.clasificacionNombre} ({formatoCantidad(m.cantidad)})
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {descuentos.length === 0 ? (
                  <p className="t-aux" style={{ textAlign: 'center', padding: '8px 0' }}>
                    Sin descuentos adicionales agregados.
                  </p>
                ) : (
                  <div className="pila-8">
                    {descuentos.map((d, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select
                          className="inp"
                          style={{ width: 100 }}
                          value={d.tipo}
                          onChange={(e) => actualizarDescuento(idx, 'tipo', e.target.value)}
                        >
                          <option value="flete">Flete</option>
                          <option value="tara">Tara</option>
                          <option value="merma">Merma</option>
                          <option value="otro">Otro</option>
                        </select>
                        <input
                          className="inp"
                          style={{ flex: 1 }}
                          value={d.concepto}
                          onChange={(e) => actualizarDescuento(idx, 'concepto', e.target.value)}
                          placeholder="Concepto del descuento"
                        />
                        <div style={{ width: 110 }}>
                          <EntradaImporte
                            id={`desc-${idx}`}
                            valor={d.monto}
                            alCambiar={(m) => actualizarDescuento(idx, 'monto', m)}
                            placeholder="0"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-icono"
                          onClick={() => quitarDescuento(idx)}
                          aria-label="Quitar descuento"
                        >
                          <Trash2 className="ic" style={{ color: 'var(--peligro)' }} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingTop: 8,
                    borderTop: '1px solid var(--borde)',
                  }}
                >
                  <span className="t-aux">Total de descuentos:</span>
                  <span className="num" style={{ fontWeight: 600 }}>−{formatoMXN(totalDescuentos)}</span>
                </div>
              </div>

              {/* Resumen Final / Neto */}
              <div className="card pila-12" style={{ padding: 16, background: 'var(--fondo-superficie)' }}>
                <p style={{ fontWeight: 600, fontSize: 16 }}>Liquidación a Pagar</p>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="t-aux">Total vendido:</span>
                  <span className="num">{formatoMXN(totalVendido)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="t-aux">Comisión del comerciante:</span>
                  <span className="num" style={{ color: 'var(--exito, #16a34a)' }}>
                    −{formatoMXN(comisionFinalEfectiva)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="t-aux">Descuentos (flete, taras, etc.):</span>
                  <span className="num" style={{ color: 'var(--peligro, #dc2626)' }}>
                    −{formatoMXN(totalDescuentos)}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    paddingTop: 8,
                    borderTop: '2px solid var(--borde)',
                  }}
                >
                  <strong style={{ fontSize: 16 }}>Neto a favor del productor:</strong>
                  <strong className="num" style={{ fontSize: 24, color: 'var(--primario)' }}>
                    {formatoMXN(neto)}
                  </strong>
                </div>
              </div>

              {error && <AvisoLinea tono="err">{error}</AvisoLinea>}

              <button
                type="button"
                className="btn btn-p btn-lg"
                disabled={!enLinea || guardando || renglonesElegidos.length === 0}
                onClick={() => void emitir()}
              >
                <Calculator className="ic" />
                {guardando ? 'Emitiendo corte...' : `Emitir corte · ${formatoMXN(neto)}`}
              </button>
            </>
          )}
        </div>
      </main>
    </>
  );
}
