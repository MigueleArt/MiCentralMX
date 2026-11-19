import { ChevronRight, CircleCheck, Copy } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { EstadoVacio, Esqueleto, AvisoLinea } from '../../componentes/Estados';
import { Buscador, coincide } from '../../componentes/Formulario';
import { InsigniaCliente } from '../../componentes/Insignias';
import type { Pago } from '@micentralmx/shared/entidades';
import { ETIQUETA_METODO } from '../../dominio/formato';
import { useClientes } from '../../hooks/useDatosLocales';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN } from '../../lib/dinero';
import { iniciales } from '../../lib/ids';
import { copiarAlPortapapeles, textoComprobanteAbono } from './comprobantes';
import { RegistrarPago } from './RegistrarPago';

/** Registrar abono desde Inicio o Deudas: se elige al cliente y el abono se aplica a su deuda más antigua o elegida. */
export default function Cobrar() {
  const { sesion } = useSesionActiva();
  const clientes = useClientes();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [registrado, setRegistrado] = useState<{
    pago: Pago;
    saldoAnterior: string;
    saldoRestante: string;
  } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const clienteId = params.get('cliente');
  const conSaldo = (clientes ?? []).filter((c) => c.saldo.gt(0) && coincide(`${c.cliente.nombre} ${c.cliente.telefono}`, q));
  const elegido = clientes?.find((c) => c.cliente.id === clienteId);

  const copiar = async () => {
    if (!registrado) return;
    const ok = await copiarAlPortapapeles(
      textoComprobanteAbono({
        negocio: sesion.negocio.nombre,
        clienteNombre: registrado.pago.clienteNombre,
        monto: registrado.pago.monto,
        metodo: registrado.pago.metodo,
        fecha: registrado.pago.creadoEnDispositivo,
        saldoAnterior: registrado.saldoAnterior,
        saldoRestante: registrado.saldoRestante,
        nota: registrado.pago.nota,
      }),
    );
    if (ok) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    }
  };

  return (
    <>
      <EncabezadoSecundario titulo="Registrar abono" subtitulo="Elige al cliente que abona" cerrar />
      <main className="pag-main con-enc-sec">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto' }}>
          {registrado && (
            <AvisoLinea tono="ok" icono={<CircleCheck className="ic" />}>
              <div className="fila-entre" style={{ flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <strong>Abono registrado correctamente</strong>
                  {formatoMXN(registrado.pago.monto)} de {registrado.pago.clienteNombre} en {ETIQUETA_METODO[registrado.pago.metodo].toLowerCase()}
                  {D(registrado.pago.excedente).gt(0) && ` · ${formatoMXN(registrado.pago.excedente)} como saldo a favor (en revisión)`}.{' '}
                  <Link to={`/clientes/${registrado.pago.clienteId}`}>Ver cliente</Link>
                </div>
                <button type="button" className="btn btn-q btn-sm" onClick={() => void copiar()}>
                  <Copy className="ic" />
                  {copiado ? 'Copiado' : 'Copiar comprobante'}
                </button>
              </div>
            </AvisoLinea>
          )}
          <Buscador valor={q} alCambiar={setQ} etiqueta="Buscar cliente" marcador="Buscar cliente o teléfono" />
          {!clientes ? (
            <Esqueleto />
          ) : conSaldo.length === 0 ? (
            <EstadoVacio titulo={q ? 'Sin resultados' : 'Nadie debe por ahora'} texto={q ? `No hay clientes con saldo que coincidan con “${q}”.` : 'Los clientes con ventas a crédito pendientes aparecerán aquí.'} />
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              {conSaldo.map((c) => (
                <button key={c.cliente.id} type="button" className="rowlink" onClick={() => setParams({ cliente: c.cliente.id }, { replace: true })}>
                  <span className="avatar">{iniciales(c.cliente.nombre)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600 }}>{c.cliente.nombre}</p>
                    <p className="t-aux">
                      {c.deudasAbiertas.length} {c.deudasAbiertas.length === 1 ? 'deuda' : 'deudas'}
                    </p>
                  </div>
                  <div className="pila" style={{ alignItems: 'flex-end', gap: 4 }}>
                    <p className="num" style={{ fontWeight: 700 }}>{formatoMXN(c.saldo)}</p>
                    <InsigniaCliente estado={c.estado} />
                  </div>
                  <ChevronRight className="ic" />
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
      {elegido && (
        <RegistrarPago
          clienteId={elegido.cliente.id}
          clienteNombre={elegido.cliente.nombre}
          ventaId={null}
          saldo={elegido.saldo.toString()}
          alCerrar={() => setParams({}, { replace: true })}
          alRegistrar={(p) => {
            const saldoAnterior = elegido.saldo.toString();
            const saldoRestante = elegido.saldo.minus(p.monto).toFixed(2);
            setCopiado(false);
            setRegistrado({ pago: p, saldoAnterior, saldoRestante });
            setParams({}, { replace: true });
          }}
        />
      )}
    </>
  );
}
