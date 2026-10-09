import { useLiveQuery } from 'dexie-react-hooks';
import {
  CircleAlert,
  CircleCheck,
  Clock3,
  CloudUpload,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useSesion } from '../auth/SesionContext';
import { db, type OperacionLocal } from '../db/db';
import { useResumenSync } from '../hooks/useResumenSync';
import { formatoRelativo, ahoraIso } from '../lib/fechas';
import { sincronizar } from '../sync/motor';
import { AvisoLinea } from './Estados';
import { HojaInferior } from './Superpuestos';

const Contexto = createContext<() => void>(() => {});
export const useAbrirSincronizacion = () => useContext(Contexto);

export function SincronizacionProvider({ children }: { children: ReactNode }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <Contexto.Provider value={() => setAbierta(true)}>
      {children}
      {abierta && <HojaSincronizacion alCerrar={() => setAbierta(false)} />}
    </Contexto.Provider>
  );
}

/** Insignia de estado de sincronización del encabezado (decisiones técnicas §5). */
export function EstadoSync({ largo = false }: { largo?: boolean }) {
  const r = useResumenSync();
  const abrir = useAbrirSincronizacion();
  const p = r.pendientes;
  const contenido: Record<typeof r.estado, [string, string, ReactNode]> = {
    actualizado: ['s-ok', largo ? 'Todo actualizado' : 'Actualizado', <CircleCheck className="ic" />],
    sin_conexion: ['s-off', p > 0 ? `Sin conexión · ${p} ${p === 1 ? 'pendiente' : 'pendientes'}` : 'Sin conexión', <WifiOff className="ic" />],
    pendientes: ['s-pend', `${p} ${p === 1 ? 'pendiente' : 'pendientes'}`, <CloudUpload className="ic" />],
    sincronizando: ['s-sync', 'Sincronizando…', <LoaderCircle className="ic girar" />],
    por_revisar: ['s-rev', `${r.porRevisar} por revisar`, <TriangleAlert className="ic" />],
    hora_incorrecta: ['s-err', 'Hora incorrecta', <Clock3 className="ic" />],
    error: ['s-err', 'Error al sincronizar', <CircleAlert className="ic" />],
  };
  const [clase, texto, icono] = contenido[r.estado];
  return (
    <button type="button" className={`sync ${clase}`} onClick={abrir} aria-label={`Sincronización: ${texto}`}>
      {icono}
      {texto}
    </button>
  );
}

/** Banner fijo en listas sin conexión (pantalla "Sin conexión" del prototipo). */
export function BannerSinConexion() {
  const r = useResumenSync();
  if (r.enLinea) return null;
  return (
    <AvisoLinea tono="warn" icono={<WifiOff className="ic" />}>
      <strong>Sin conexión</strong>
      Los cambios se guardan en este dispositivo y se sincronizarán cuando vuelva Internet.
      {r.pendientes > 0 && (
        <span style={{ display: 'block', fontWeight: 600, marginTop: 2 }}>
          {r.pendientes} {r.pendientes === 1 ? 'cambio pendiente' : 'cambios pendientes'}
        </span>
      )}
    </AvisoLinea>
  );
}

function rutaDe(op: OperacionLocal): string | null {
  switch (op.tipo) {
    case 'venta.crear':
      return `/ventas/${op.entidadId}`;
    case 'pago.crear':
      return `/clientes/${(op.datos as { clienteId: string }).clienteId}`;
    case 'cliente.crear':
      return `/clientes/${op.entidadId}`;
    case 'compra.crear':
      return '/compras';
    case 'merma.crear':
      return '/inventario/mermas';
    case 'movimiento_dinero.crear':
      return '/pagos';
  }
}

function FilaOperacion({ op, alNavegar }: { op: OperacionLocal; alNavegar: () => void }) {
  const ruta = rutaDe(op);
  const [icono, texto, fondo, color] = {
    pendiente: [<Clock3 className="ic" />, 'Pendiente', 'var(--gris-1)', 'var(--texto-neutro)'],
    enviando: [<LoaderCircle className="ic girar" />, 'Enviando…', 'var(--info-fondo)', 'var(--info-texto)'],
    sincronizada: [<CircleCheck className="ic" />, 'Enviada', 'var(--ok-fondo)', 'var(--ok-texto)'],
    en_revision: [<TriangleAlert className="ic" />, 'En revisión', 'var(--acento-fondo)', 'var(--acento-texto)'],
    rechazada: [<CircleAlert className="ic" />, 'Rechazada', 'var(--error-fondo)', 'var(--error-texto)'],
  }[op.estado] as [ReactNode, string, string, string];
  return (
    <li className="tl" style={{ alignItems: 'flex-start' }}>
      <span className="dot" style={{ background: fondo, color }}>
        {icono}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {ruta ? (
          <Link to={ruta} onClick={alNavegar} style={{ fontSize: 15, fontWeight: 600, color: 'var(--texto)', textDecoration: 'none' }}>
            {op.resumen}
          </Link>
        ) : (
          <p style={{ fontSize: 15, fontWeight: 600 }}>{op.resumen}</p>
        )}
        <p className="t-aux num">
          {texto} · {formatoRelativo(op.creadoEnDispositivo)}
        </p>
        {op.motivo && (op.estado === 'en_revision' || op.estado === 'rechazada') && (
          <p className="t-2" style={{ color, marginTop: 2 }}>
            {op.motivo}
          </p>
        )}
      </div>
    </li>
  );
}

export function HojaSincronizacion({ alCerrar }: { alCerrar: () => void }) {
  const r = useResumenSync();
  const { puede } = useSesion();
  const ops = useLiveQuery(() => db.operaciones.orderBy('creadoEnDispositivo').reverse().limit(60).toArray());
  const ultimoPull = r.ultimoPull;
  const enCola = ops?.filter((o) => o.estado === 'pendiente' || o.estado === 'enviando') ?? [];
  const revisar = ops?.filter((o) => (o.estado === 'en_revision' || o.estado === 'rechazada') && !o.enteradoEn) ?? [];
  const recientes = ops?.filter((o) => o.estado === 'sincronizada').slice(0, 5) ?? [];

  const entendido = () =>
    db.operaciones
      .where('operacionId')
      .anyOf(revisar.map((o) => o.operacionId))
      .modify({ enteradoEn: ahoraIso() });

  let titulo = 'Todo actualizado';
  let detalle = ultimoPull ? `Última sincronización: ${formatoRelativo(ultimoPull)}` : 'Aún no se sincroniza este dispositivo.';
  if (!r.enLinea) {
    titulo = 'Sin conexión';
    detalle = 'Los cambios se guardan en este dispositivo y se enviarán cuando vuelva Internet.';
  } else if (r.estado === 'sincronizando') {
    titulo = 'Sincronizando…';
    detalle = enCola.length ? `Enviando ${enCola.length} ${enCola.length === 1 ? 'cambio guardado' : 'cambios guardados'} sin conexión` : 'Descargando cambios recientes';
  } else if (enCola.length) {
    titulo = `${enCola.length} ${enCola.length === 1 ? 'cambio pendiente' : 'cambios pendientes'}`;
  }

  return (
    <HojaInferior titulo="Sincronización" alCerrar={alCerrar}>
      <div className="fila" style={{ gap: 12 }}>
        <span className="cuadro-ic" style={{ width: 44, height: 44, background: r.enLinea ? 'var(--info-fondo)' : 'var(--aviso-fondo)', color: r.enLinea ? 'var(--info-texto)' : 'var(--aviso-texto)' }}>
          {r.estado === 'sincronizando' ? <LoaderCircle className="ic girar" /> : r.enLinea ? <Wifi className="ic" /> : <WifiOff className="ic" />}
        </span>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 17, fontWeight: 700 }}>{titulo}</p>
          <p className="t-2">{detalle}</p>
        </div>
      </div>

      {r.horaIncorrecta && (
        <AvisoLinea tono="err" icono={<Clock3 className="ic" />}>
          <strong>La hora de tu teléfono no es correcta</strong>
          Ajusta la fecha y hora automáticas. Lo registrado mientras tanto quedará en revisión.
        </AvisoLinea>
      )}
      {r.error && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{r.error}</AvisoLinea>}

      {revisar.length > 0 && (
        <section className="pila-12">
          <div className="fila-entre">
            <h3 className="lbl">Requiere revisión</h3>
            <button type="button" className="enlace" onClick={entendido} style={{ minHeight: 32 }}>
              Entendido
            </button>
          </div>
          <p className="t-2">
            {puede('revisiones.resolver') ? (
              <>
                Resuélvelas en{' '}
                <Link to="/revisiones" onClick={alCerrar}>
                  Revisiones
                </Link>
                . Lo demás se sincronizó normalmente.
              </>
            ) : (
              'Un administrador las revisa en el servidor. Lo demás se sincronizó normalmente.'
            )}
          </p>
          <ol className="pila-12">
            {revisar.map((o) => (
              <FilaOperacion key={o.operacionId} op={o} alNavegar={alCerrar} />
            ))}
          </ol>
        </section>
      )}

      {enCola.length > 0 && (
        <section className="pila-12">
          <h3 className="lbl">Por enviar</h3>
          <ol className="pila-12">
            {enCola.map((o) => (
              <FilaOperacion key={o.operacionId} op={o} alNavegar={alCerrar} />
            ))}
          </ol>
        </section>
      )}

      {recientes.length > 0 && (
        <section className="pila-12">
          <h3 className="lbl">Enviadas recientemente</h3>
          <ol className="pila-12">
            {recientes.map((o) => (
              <FilaOperacion key={o.operacionId} op={o} alNavegar={alCerrar} />
            ))}
          </ol>
        </section>
      )}

      <p className="t-2">Puedes seguir trabajando mientras termina.</p>
      <div className="pila">
        <button type="button" className="btn btn-p" disabled={!r.enLinea || r.estado === 'sincronizando'} onClick={() => void sincronizar()}>
          <RefreshCw className="ic" />
          Sincronizar ahora
        </button>
        <button type="button" className="btn btn-q" onClick={alCerrar}>
          Cerrar
        </button>
      </div>
    </HojaInferior>
  );
}
