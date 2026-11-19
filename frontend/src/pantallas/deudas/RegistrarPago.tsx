import { ArrowLeftRight, Banknote, CircleAlert, Ellipsis, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { AvisoLinea } from '../../componentes/Estados';
import { Campo, EntradaImporte, Segmentado } from '../../componentes/Formulario';
import { HojaInferior } from '../../componentes/Superpuestos';
import type { MetodoPago, Pago } from '@micentralmx/shared/entidades';
import type { VentaVista } from '../../dominio/consultas';
import { ErrorAlmacenamiento, ErrorValidacion } from '../../dominio/errores';
import { folioVenta } from '../../dominio/formato';
import { registrarPago, sugerirAplicaciones } from '../../dominio/operaciones';
import { D, formatoMXN } from '../../lib/dinero';
import { montosRapidosAbono } from './comprobantes';

type Reparto = Awaited<ReturnType<typeof sugerirAplicaciones>>;

/**
 * Pantalla 12 · Registrar abono (hoja inferior). Desde una deuda se aplica a esa venta;
 * desde el cliente, a la deuda que vence antes o a la elegida. El excedente queda como saldo a favor en revisión.
 */
export function RegistrarPago({
  clienteId,
  clienteNombre,
  ventaId,
  saldo,
  alCerrar,
  alRegistrar,
  titulo = 'Registrar abono',
}: {
  clienteId: string;
  clienteNombre: string;
  ventaId: string | null;
  saldo: string;
  alCerrar: () => void;
  alRegistrar: (p: Pago) => void;
  titulo?: string;
}) {
  const { soloLectura } = useSesionActiva();
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [nota, setNota] = useState('');
  const [destinoVentaId, setDestinoVentaId] = useState<string | null>(ventaId);
  const [deudasCliente, setDeudasCliente] = useState<VentaVista[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorMonto, setErrorMonto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [reparto, setReparto] = useState<Reparto | null>(null);

  useEffect(() => {
    setDestinoVentaId(ventaId);
  }, [ventaId]);

  useEffect(() => {
    if (ventaId !== null) return;
    let vigente = true;
    void sugerirAplicaciones(clienteId, '0', null).then((r) => vigente && setDeudasCliente(r.deudas));
    return () => {
      vigente = false;
    };
  }, [clienteId, ventaId]);

  const objetivoVentaId = ventaId ?? destinoVentaId;

  useEffect(() => {
    let vigente = true;
    void sugerirAplicaciones(clienteId, monto || '0', objetivoVentaId).then((r) => vigente && setReparto(r));
    return () => {
      vigente = false;
    };
  }, [clienteId, monto, objetivoVentaId]);

  const deudaObjetivo = objetivoVentaId ? deudasCliente.find((d) => d.venta.id === objetivoVentaId) : null;
  const saldoEfectivoD = ventaId === null && deudaObjetivo ? deudaObjetivo.saldo : D(saldo);
  const montoD = D(monto || 0);
  const despues = saldoEfectivoD.minus(montoD);
  const excedente = D(reparto?.excedente ?? 0);
  const pctCubierto = saldoEfectivoD.gt(0) ? Math.min(100, Math.max(0, montoD.div(saldoEfectivoD).times(100).toNumber())) : 0;
  const atajos = montosRapidosAbono(saldoEfectivoD);

  const registrar = async () => {
    setError(null);
    setErrorMonto(null);
    setGuardando(true);
    try {
      const p = await registrarPago({ clienteId, monto, metodo, nota: nota || null, ventaId: objetivoVentaId });
      alRegistrar(p);
    } catch (e) {
      if (e instanceof ErrorValidacion && e.campo === 'monto') setErrorMonto(e.message);
      else if (e instanceof ErrorAlmacenamiento) setError('No se pudo guardar en este dispositivo; el almacenamiento del navegador no respondió. Tus datos siguen en el formulario.');
      else setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <HojaInferior titulo={titulo} subtitulo={`${clienteNombre} · Saldo ${formatoMXN(saldoEfectivoD)}`} alCerrar={alCerrar}>
      {ventaId === null && deudasCliente.length > 1 && (
        <Campo etiqueta="Aplicar a" id="destino-deuda">
          <select
            id="destino-deuda"
            className="inp"
            value={destinoVentaId ?? ''}
            onChange={(e) => setDestinoVentaId(e.target.value || null)}
          >
            <option value="">Automático (deuda más antigua primero)</option>
            {deudasCliente.map((d) => (
              <option key={d.venta.id} value={d.venta.id}>
                Venta {folioVenta(d.venta)} · Saldo {formatoMXN(d.saldo)}
              </option>
            ))}
          </select>
        </Campo>
      )}

      <Campo etiqueta="Cantidad recibida" id="amt" error={errorMonto}>
        <EntradaImporte id="amt" valor={monto} alCambiar={setMonto} grande placeholder="0" error={errorMonto} autoFocus />
      </Campo>

      {atajos.length > 0 && (
        <div className="fila" style={{ flexWrap: 'wrap' }}>
          {atajos.map((op) => (
            <button
              key={op.monto}
              type="button"
              className="chip"
              aria-pressed={monto === op.monto}
              onClick={() => setMonto(op.monto)}
            >
              {op.etiqueta}
            </button>
          ))}
        </div>
      )}

      <fieldset className="pila">
        <legend className="flabel" style={{ marginBottom: 6 }}>
          Método de pago
        </legend>
        <Segmentado<MetodoPago>
          etiqueta="Método de pago"
          valor={metodo}
          alCambiar={setMetodo}
          opciones={[
            { valor: 'efectivo', texto: 'Efectivo', icono: <Banknote className="ic" /> },
            { valor: 'transferencia', texto: 'Transferencia', icono: <ArrowLeftRight className="ic" /> },
            { valor: 'otro', texto: 'Otro', icono: <Ellipsis className="ic" /> },
          ]}
        />
      </fieldset>
      <Campo etiqueta="Nota" id="ref" opcional>
        <input id="ref" className="inp" placeholder="Ej. Abono en bodega" value={nota} onChange={(e) => setNota(e.target.value)} />
      </Campo>

      {!objetivoVentaId && reparto && reparto.aplicaciones.length > 0 && (
        <div className="card" style={{ padding: '4px 14px' }}>
          <p className="lbl" style={{ padding: '10px 0 2px' }}>Se aplica a</p>
          {reparto.aplicaciones.map((a) => {
            const d = reparto.deudas.find((x) => x.venta.id === a.ventaId);
            return (
              <div key={a.ventaId} className="kv">
                <dt>Venta {d ? folioVenta(d.venta) : ''}</dt>
                <dd className="num">{formatoMXN(a.monto)}</dd>
              </div>
            );
          })}
        </div>
      )}

      <div className="card pila" style={{ padding: '12px 14px', background: 'var(--fondo-tabla)', gap: 8 }}>
        <div className="fila-entre">
          <span className="t-2">Saldo después del abono</span>
          <div className="fila">
            {montoD.gt(0) && despues.lte(0) && <span className="bdg b-ok bdg-sm">Queda liquidada</span>}
            <span className="num" style={{ fontWeight: 700, fontSize: 18 }}>
              {formatoMXN(despues.lt(0) ? 0 : despues)}
            </span>
          </div>
        </div>
        <div className="bar">
          <span style={{ width: `${pctCubierto}%` }} />
        </div>
      </div>

      {excedente.gt(0) && (
        <AvisoLinea tono="warn" icono={<TriangleAlert className="ic" />}>
          <strong>Recibes {formatoMXN(excedente)} de más</strong>
          El excedente quedará como saldo a favor del cliente y en revisión.
        </AvisoLinea>
      )}
      {error && (
        <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>
          {error}
        </AvisoLinea>
      )}
      <div className="pila">
        <button type="button" className="btn btn-p btn-lg" disabled={guardando || soloLectura || montoD.lte(0)} onClick={() => void registrar()}>
          Registrar abono{montoD.gt(0) ? ` de ${formatoMXN(montoD)}` : ''}
        </button>
        <button type="button" className="btn btn-q" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </HojaInferior>
  );
}
