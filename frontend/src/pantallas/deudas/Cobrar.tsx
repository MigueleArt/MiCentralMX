import { ChevronRight, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EstadoVacio, Esqueleto, AvisoLinea } from '../../componentes/Estados';
import { Buscador, coincide } from '../../componentes/Formulario';
import { InsigniaCliente } from '../../componentes/Insignias';
import type { Pago } from '@micentralmx/shared/entidades';
import { ETIQUETA_METODO } from '../../dominio/formato';
import { useClientes } from '../../hooks/useDatosLocales';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN } from '../../lib/dinero';
import { iniciales } from '../../lib/ids';
import { RegistrarPago } from './RegistrarPago';

/** Registrar pago desde Inicio o desde un cliente: se elige el cliente y el pago se aplica a su deuda más antigua. */
export default function Cobrar() {
  const clientes = useClientes();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [registrado, setRegistrado] = useState<Pago | null>(null);
  const clienteId = params.get('cliente');
  const conSaldo = (clientes ?? []).filter((c) => c.saldo.gt(0) && coincide(`${c.cliente.nombre} ${c.cliente.telefono}`, q));
  const elegido = clientes?.find((c) => c.cliente.id === clienteId);

  return (
    <>
      <EncabezadoSecundario titulo="Registrar pago" subtitulo="Elige al cliente que paga" cerrar />
      <main className="pag-main con-enc-sec">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto' }}>
          {registrado && (
            <AvisoLinea tono="ok" icono={<CircleCheck className="ic" />}>
              <strong>Pago registrado correctamente</strong>
              {formatoMXN(registrado.monto)} de {registrado.clienteNombre} en {ETIQUETA_METODO[registrado.metodo].toLowerCase()}
              {D(registrado.excedente).gt(0) && ` · ${formatoMXN(registrado.excedente)} como saldo a favor (en revisión)`}.{' '}
              <Link to={`/clientes/${registrado.clienteId}`}>Ver cliente</Link>
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
            setRegistrado(p);
            setParams({}, { replace: true });
          }}
        />
      )}
    </>
  );
}
