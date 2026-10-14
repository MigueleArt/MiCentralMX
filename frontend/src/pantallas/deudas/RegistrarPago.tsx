import { ArrowLeftRight, Banknote, CircleAlert, Ellipsis, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { AvisoLinea } from '../../componentes/Estados';
import { Campo, EntradaImporte, Segmentado } from '../../componentes/Formulario';
import { HojaInferior } from '../../componentes/Superpuestos';
import type { MetodoPago, Pago } from '@micentralmx/shared/entidades';
import { ErrorAlmacenamiento, ErrorValidacion } from '../../dominio/errores';
import { folioVenta } from '../../dominio/formato';
import { registrarPago, sugerirAplicaciones } from '../../dominio/operaciones';
import { D, formatoMXN } from '../../lib/dinero';

type Reparto = Awaited<ReturnType<typeof sugerirAplicaciones>>;

/**
 * Pantalla 12 · Registrar pago (hoja inferior). Desde una deuda se aplica a esa venta;
 * desde el cliente, a la deuda que vence antes. El excedente queda como saldo a favor en revisión.
 */
export function RegistrarPago({
  clienteId,
  clienteNombre,
  ventaId,
  saldo,
  alCerrar,
  alRegistrar,
}: {
  clienteId: string;
  clienteNombre: string;
  ventaId: string | null;
  saldo: string;
  alCerrar: () => void;
  alRegistrar: (p: Pago) => void;
}) {
  const { soloLectura } = useSesionActiva();
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorMonto, setErrorMonto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [reparto, setReparto] = useState<Reparto | null>(null);

  useEffect(() => {
    let vigente = true;
    void sugerirAplicaciones(clienteId, monto || '0', ventaId).then((r) => vigente && setReparto(r));
    return () => {
      vigente = false;
    };
  }, [clienteId, monto, ventaId]);

  const saldoD = D(saldo);
  const montoD = D(monto || 0);
  const despues = saldoD.minus(montoD);
  const excedente = D(reparto?.excedente ?? 0);

  const registrar = async () => {
    setError(null);
    setErrorMonto(null);
    setGuardando(true);
    try {
      const p = await registrarPago({ clienteId, monto, metodo, nota: nota || null, ventaId });
      alRegistrar(p);
    } catch (e) {
      if (e instanceof ErrorValidacion && e.campo === 'monto') setErrorMonto(e.message);
      else if (e instanceof ErrorAlmacenamiento) setError('No se pudo guardar en este dispositivo; el almacenamiento del navegador no respondió. Tus datos siguen en el formulario.');
      else setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  const mitad = saldoD.div(2).toDecimalPlaces(2);
  return (
    <HojaInferior titulo="Registrar pago" subtitulo={`${clienteNombre} · Saldo ${formatoMXN(saldo)}`} alCerrar={alCerrar}>
      <Campo etiqueta="Cantidad recibida" id="amt" error={errorMonto}>
        <EntradaImporte id="amt" valor={monto} alCambiar={setMonto} grande placeholder="0" error={errorMonto} autoFocus />
      </Campo>
      {saldoD.gt(0) && (
        <div className="fila">
          <button type="button" className="chip" onClick={() => setMonto(saldoD.toString())}>
            Liquidar {formatoMXN(saldoD)}
          </button>
          <button type="button" className="chip" onClick={() => setMonto(mitad.toString())}>
            Mitad {formatoMXN(mitad)}
          </button>
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
        <input id="ref" className="inp" placeholder="Ej. Pagó en bodega" value={nota} onChange={(e) => setNota(e.target.value)} />
      </Campo>

      {!ventaId && reparto && reparto.aplicaciones.length > 0 && (
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

      <div className="fila-entre card" style={{ padding: '12px 14px', background: 'var(--fondo-tabla)' }}>
        <span className="t-2">Saldo después del pago</span>
        <span className="num" style={{ fontWeight: 700, fontSize: 18 }}>
          {formatoMXN(despues.lt(0) ? 0 : despues)}
        </span>
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
          Registrar pago{montoD.gt(0) ? ` de ${formatoMXN(montoD)}` : ''}
        </button>
        <button type="button" className="btn btn-q" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </HojaInferior>
  );
}
