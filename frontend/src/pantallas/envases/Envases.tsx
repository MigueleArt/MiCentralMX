import { useLiveQuery } from 'dexie-react-hooks';
import type { FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Boxes, Check, CircleAlert, LoaderCircle, Plus, Scale } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { InsigniaSync } from '../../componentes/Insignias';
import { saldosEnvases, type SaldoEnvaseCliente } from '../../dominio/envases';
import { ErrorAlmacenamiento, ErrorValidacion } from '../../dominio/errores';
import { registrarMovimientoEnvase } from '../../dominio/operaciones';
import { useClientes } from '../../hooks/useDatosLocales';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { formatoRelativo } from '../../lib/fechas';

type TipoMovimiento = 'entrega' | 'devolucion' | 'saldo_inicial' | 'ajuste';
const comunes = ['Caja', 'Tara', 'Arpilla'];
const nombreTipo: Record<TipoMovimiento, string> = {
  entrega: 'Entrega',
  devolucion: 'Devolución',
  saldo_inicial: 'Saldo contado',
  ajuste: 'Ajuste',
};

export default function Envases() {
  const { puede } = useSesionActiva();
  const avisar = useAvisos();
  const clientes = useClientes();
  const [params] = useSearchParams();
  const saldos = useLiveQuery(saldosEnvases);
  const [abierto, setAbierto] = useState(false);
  const [clienteId, setClienteId] = useState(params.get('cliente') ?? '');
  const [envase, setEnvase] = useState(params.get('envase') ?? 'Caja');
  const [tipo, setTipo] = useState<TipoMovimiento>('entrega');
  const [direccion, setDireccion] = useState<'aumenta' | 'reduce'>('aumenta');
  const [cantidad, setCantidad] = useState('1');
  const [nota, setNota] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const registrados = saldos ?? [];
  const grupos = new Map<string, SaldoEnvaseCliente>();
  for (const g of registrados) grupos.set(`${g.clienteId}:${g.envase.toLocaleLowerCase()}`, g);
  const confirmarPendientes = registrados.filter((g) => !g.confirmado && !g.soloRechazados).length;
  const porRecuperar = registrados.filter((g) => g.confirmado && g.saldo > 0).reduce((n, g) => n + g.saldo, 0);
  const filtro = busqueda.trim().toLocaleLowerCase();
  const lista = registrados.filter((g) => !filtro || `${g.clienteNombre} ${g.envase}`.toLocaleLowerCase().includes(filtro));
  const clienteSeleccionado = clientes?.find((x) => x.cliente.id === clienteId)?.cliente;

  const registrar = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      await registrarMovimientoEnvase({
        clienteId,
        envase,
        tipo,
        cantidad,
        direccion: tipo === 'ajuste' ? direccion : null,
        nota: nota.trim() || null,
        ventaId: params.get('venta'),
      });
      avisar(tipo === 'saldo_inicial' ? 'Saldo inicial guardado' : `${nombreTipo[tipo]} registrada`);
      setCantidad('1');
      setNota('');
      setTipo('entrega');
      setAbierto(false);
    } catch (e) {
      if (e instanceof ErrorValidacion) setError(e.message);
      else if (e instanceof ErrorAlmacenamiento) setError('No se pudo guardar en este dispositivo. Conservamos el formulario para intentar otra vez.');
      else setError(e instanceof Error ? e.message : 'No se pudo guardar el movimiento.');
    } finally {
      setGuardando(false);
    }
  };

  const iniciar = (g?: SaldoEnvaseCliente, modo: TipoMovimiento = 'entrega') => {
    setClienteId(g?.clienteId ?? params.get('cliente') ?? '');
    setEnvase(g?.envase ?? 'Caja');
    setTipo(modo);
    setCantidad(modo === 'saldo_inicial' ? '0' : '1');
    setNota('');
    setError('');
    setAbierto(true);
    window.setTimeout(() => document.getElementById('form-envases')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  return (
    <>
      <EncabezadoSecundario
        titulo="Cajas por recuperar"
        subtitulo="Control de envases retornables por cliente"
        volverA={params.get('venta') ? `/ventas/${params.get('venta')}` : params.get('cliente') ? `/clientes/${params.get('cliente')}` : '/mas'}
        conSync
        acciones={puede('envases.gestionar') ? <button className="icon-btn" type="button" aria-label="Registrar movimiento" onClick={() => iniciar()}><Plus className="ic" /></button> : undefined}
      />
      <main className="pag-main con-enc-sec con-barra">
        <div className="pila-16" style={{ width: '100%', maxWidth: 900, margin: '0 auto' }}>
          <p className="t-2">Lleva el saldo físico de cajas y taras por separado de las deudas en dinero.</p>
          <div className="rejilla-2">
            <section className="card kpi">
              <p className="t-2">Envases confirmados por recuperar</p>
              <p className="num valor" style={{ color: 'var(--color-primario-osc)' }}>{porRecuperar}</p>
              <p className="t-aux">Solo saldos con conteo inicial</p>
            </section>
            <section className="card kpi">
              <p className="t-2">Saldos por confirmar</p>
              <p className="num valor" style={{ color: confirmarPendientes ? 'var(--aviso-texto)' : 'var(--texto)' }}>{confirmarPendientes}</p>
              <p className="t-aux">Cliente y tipo de envase</p>
            </section>
          </div>

          {params.get('venta') && (
            <div className="aviso-linea info"><Boxes className="ic" /><span>Movimiento relacionado con la venta. Selecciona el cliente de esa venta.</span></div>
          )}

          {abierto && (
            <form id="form-envases" className="card pila-16" style={{ padding: 16, scrollMarginTop: 82 }} onSubmit={(e) => void registrar(e)}>
              <div className="fila-entre">
                <div><h2 className="t-sec">Registrar movimiento</h2><p className="t-aux">Se guardará también si trabajas sin conexión.</p></div>
                <button className="icon-btn" type="button" aria-label="Cerrar formulario" onClick={() => setAbierto(false)}>×</button>
              </div>
              <div className="field">
                <label className="flabel" htmlFor="envase-cliente">Cliente</label>
                <select id="envase-cliente" className="inp" value={clienteId} onChange={(e) => setClienteId(e.target.value)} required disabled={!!params.get('venta')}>
                  <option value="">Seleccionar cliente…</option>
                  {(clientes ?? []).map((c) => <option key={c.cliente.id} value={c.cliente.id}>{c.cliente.nombre}</option>)}
                </select>
                {clienteSeleccionado && <span className="hint">{params.get('venta') ? 'Cliente vinculado a la venta seleccionada.' : 'Saldo monetario del cliente: no se modifica aquí.'}</span>}
              </div>
              <div className="field">
                <label className="flabel" htmlFor="envase-tipo">Tipo de envase</label>
                <input id="envase-tipo" className="inp" list="envase-comunes" value={envase} onChange={(e) => setEnvase(e.target.value)} maxLength={60} required />
                <datalist id="envase-comunes">{[...new Set([...comunes, ...registrados.map((g) => g.envase)])].map((x) => <option key={x} value={x} />)}</datalist>
              </div>
              <div className="field">
                <label className="flabel" htmlFor="envase-movimiento">Movimiento</label>
                <select id="envase-movimiento" className="inp" value={tipo} onChange={(e) => { const t = e.target.value as TipoMovimiento; setTipo(t); setCantidad(t === 'saldo_inicial' ? '0' : '1'); }}>
                  {Object.entries(nombreTipo).filter(([value]) => (value !== 'ajuste' && value !== 'saldo_inicial') || puede('envases.ajustar')).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              {tipo === 'ajuste' && (
                <div className="field">
                  <span className="flabel">Efecto del ajuste</span>
                  <div className="seg" role="group" aria-label="Dirección del ajuste">
                    <button type="button" aria-pressed={direccion === 'aumenta'} onClick={() => setDireccion('aumenta')}>＋ Aumenta saldo</button>
                    <button type="button" aria-pressed={direccion === 'reduce'} onClick={() => setDireccion('reduce')}>− Reduce saldo</button>
                  </div>
                </div>
              )}
              <div className="field">
                <label className="flabel" htmlFor="envase-cantidad">{tipo === 'saldo_inicial' ? 'Cantidad contada actualmente' : tipo === 'devolucion' ? 'Cantidad devuelta' : tipo === 'ajuste' ? 'Cantidad a ajustar' : 'Cantidad entregada'}</label>
                <input id="envase-cantidad" className="inp num" type="number" min={tipo === 'saldo_inicial' ? 0 : 1} step="1" inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
                {tipo === 'saldo_inicial' && <span className="hint">El conteo crea la base para calcular el saldo pendiente de este cliente y envase.</span>}
              </div>
              <div className="field">
                <label className="flabel" htmlFor="envase-nota">Nota <span style={{ fontWeight: 400 }}>{tipo === 'ajuste' ? '(obligatoria)' : '(opcional)'}</span></label>
                <input id="envase-nota" className="inp" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder={tipo === 'ajuste' ? 'Motivo del ajuste' : 'Ej. Se entregaron con la venta del día'} required={tipo === 'ajuste'} />
              </div>
              {tipo === 'saldo_inicial' && <div className="aviso-linea warn"><CircleAlert className="ic" /><span>Este valor se toma como el saldo contado al iniciar el control. Para corregirlo después, registra un ajuste.</span></div>}
              {error && <div className="aviso-linea err" role="alert"><CircleAlert className="ic" /><span>{error}</span></div>}
              <div className="fila" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button className="btn btn-q" type="button" onClick={() => setAbierto(false)}>Cancelar</button>
                <button className="btn btn-p" type="submit" disabled={guardando || !puede('envases.gestionar')}>{guardando ? <LoaderCircle className="ic girar" /> : <Check className="ic" />}Guardar movimiento</button>
              </div>
            </form>
          )}

          <div className="fila" style={{ gap: 10 }}>
            <label className="sr" htmlFor="buscar-envases">Buscar envases por cliente</label>
            <input id="buscar-envases" className="inp" placeholder="Buscar cliente o tipo de envase" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
          {!saldos ? <Esqueleto filas={3} /> : lista.length === 0 ? (
            <EstadoVacio icono={Boxes} titulo={registrados.length ? 'No hay coincidencias' : 'Sin movimientos de envases'} texto={registrados.length ? 'Prueba con otro nombre de cliente o envase.' : 'Registra un saldo contado o una entrega para empezar a llevar el control.'} acciones={puede('envases.gestionar') ? <button className="btn btn-p" onClick={() => iniciar()}><Plus className="ic" />Registrar movimiento</button> : undefined} />
          ) : (
            <section className="pila" aria-label="Saldos de envases por cliente">
              {lista.map((g) => (
                <article className="card pila" key={`${g.clienteId}:${g.envase}`} style={{ padding: 14, gap: 10 }}>
                  <div className="fila-entre" style={{ alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <h2 style={{ fontSize: 16, lineHeight: '22px', fontWeight: 650 }}>{g.clienteNombre}</h2>
                      <p className="t-2">{g.envase} · {g.movimientos.length} {g.movimientos.length === 1 ? 'movimiento' : 'movimientos'}</p>
                    </div>
                    <div style={{ textAlign: 'right', flex: 'none' }}>
                      <p className="num" style={{ fontSize: 23, lineHeight: '28px', fontWeight: 700, color: g.saldo < 0 ? 'var(--info-texto)' : g.saldo > 0 ? 'var(--color-primario-osc)' : 'var(--texto)' }}>{g.soloRechazados ? '—' : g.confirmado ? `${Math.abs(g.saldo)} × ${g.envase}` : 'Por contar'}</p>
                      {g.soloRechazados ? <span className="bdg bdg-sm b-errt">Movimiento rechazado</span> : <span className={`bdg bdg-sm ${g.confirmado ? g.saldo > 0 ? 'b-warn' : 'b-ok' : 'b-acc'}`}>{!g.confirmado ? 'Saldo por confirmar' : g.saldo > 0 ? 'Por recuperar' : g.saldo < 0 ? 'A favor del cliente' : 'Sin saldo pendiente'}</span>}
                    </div>
                  </div>
                  {g.soloRechazados && <p className="hint">El movimiento no se aplicó. Revisa el estado de sincronización antes de volver a registrarlo.</p>}
                  {!g.confirmado && !g.soloRechazados && <p className="hint">Movimientos netos registrados: {g.saldo > 0 ? '+' : ''}{g.saldo}. Falta contar el saldo anterior para confirmar el total.{!puede('envases.ajustar') ? ' Pide a un usuario autorizado que registre el conteo inicial.' : ''}</p>}
                  <div className="pila" style={{ gap: 4 }}>
                    {g.movimientos.slice(0, 3).map((m) => {
                      const icon = m.tipo === 'entrega' ? <ArrowUpRight className="ic" /> : m.tipo === 'devolucion' ? <ArrowDownLeft className="ic" /> : m.tipo === 'saldo_inicial' ? <Scale className="ic" /> : <Boxes className="ic" />;
                      const efecto = m.tipo === 'entrega' ? 'Entregadas' : m.tipo === 'devolucion' ? 'Devueltas' : m.tipo === 'saldo_inicial' ? 'Saldo contado' : m.direccion === 'aumenta' ? 'Ajuste +' : 'Ajuste −';
                      return <div className="fila" key={m.id} style={{ color: 'var(--texto-2)', fontSize: 13, minHeight: 25, flexWrap: 'wrap' }}>{icon}<span style={{ flex: 1 }}>{efecto}: <strong style={{ color: 'var(--texto)' }}>{m.cantidad}</strong>{m.nota ? ` · ${m.nota}` : ''}<span className="t-aux"> · {m.usuarioNombre}</span>{m.ventaId && <> · <Link to={`/ventas/${m.ventaId}`}>Ver venta</Link></>}</span><InsigniaSync estado={m.sincronizacion} /><span className="t-aux">{formatoRelativo(m.creadoEnDispositivo)}</span></div>;
                    })}
                  </div>
                  {g.movimientos.length > 3 && (
                    <details>
                      <summary className="enlace" style={{ cursor: 'pointer', fontSize: 14 }}>Ver historial completo ({g.movimientos.length})</summary>
                      <div className="pila" style={{ gap: 4, marginTop: 8 }}>
                        {g.movimientos.slice(3).map((m) => <p className="t-aux" key={m.id}>{nombreTipo[m.tipo]} · {m.cantidad} · {formatoRelativo(m.creadoEnDispositivo)}{m.nota ? ` · ${m.nota}` : ''}</p>)}
                      </div>
                    </details>
                  )}
                  {puede('envases.gestionar') && (
                    <div className="fila" style={{ flexWrap: 'wrap', gap: 6, borderTop: '1px solid var(--gris-1)', paddingTop: 9 }}>
                      {!g.confirmado && puede('envases.ajustar') && <button className="btn btn-s btn-sm" onClick={() => iniciar(g, 'saldo_inicial')}><Scale className="ic" />Contar saldo</button>}
                      <button className="btn btn-q btn-sm" onClick={() => iniciar(g, 'entrega')}><ArrowUpRight className="ic" />Entregar</button>
                      <button className="btn btn-q btn-sm" onClick={() => iniciar(g, 'devolucion')}><ArrowDownLeft className="ic" />Registrar devolución</button>
                      {puede('envases.ajustar') && <button className="btn btn-g btn-sm" onClick={() => iniciar(g, 'ajuste')}>Ajustar</button>}
                    </div>
                  )}
                </article>
              ))}
            </section>
          )}
          {registrados.length > 0 && (
            <details className="card" style={{ padding: 14 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>¿Cómo tratar saldos anteriores sin registro?</summary>
              <p className="t-2" style={{ marginTop: 10 }}>No asumimos que el saldo sea cero. Cuenta las cajas actuales con el cliente y usa <strong>Contar saldo</strong>; ese valor queda como base confirmada. Los movimientos posteriores se suman o restan desde ese conteo.</p>
            </details>
          )}
          <p className="t-aux">Este registro es físico y separado de las cuentas monetarias del cliente. Las cantidades se guardan localmente y se sincronizan cuando hay conexión.</p>
        </div>
      </main>
      {puede('envases.gestionar') && <div className="barra-accion"><button className="btn btn-p btn-lg" style={{ flex: 1 }} onClick={() => iniciar()}><Plus className="ic" />Registrar movimiento de envases</button></div>}
    </>
  );
}
