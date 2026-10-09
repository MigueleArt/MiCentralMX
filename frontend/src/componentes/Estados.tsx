import { CircleAlert, SearchX, WifiOff, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { mensajeError } from '../api/cliente';

/** Estado vacío y "sin resultados" del prototipo. */
export function EstadoVacio({
  icono: Icono = SearchX,
  titulo,
  texto,
  acciones,
}: {
  icono?: LucideIcon;
  titulo: string;
  texto: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <div className="pila-16" style={{ alignItems: 'center', textAlign: 'center', padding: '40px 16px' }}>
      <span className="cuadro-ic" style={{ width: 72, height: 72, borderRadius: 20, background: 'var(--color-primario-suave)', color: 'var(--color-primario)' }}>
        <Icono style={{ width: 32, height: 32 }} strokeWidth={1.75} />
      </span>
      <div className="pila" style={{ alignItems: 'center' }}>
        <h2 className="t-sec">{titulo}</h2>
        <p className="t-2" style={{ fontSize: 15, maxWidth: 320 }}>
          {texto}
        </p>
      </div>
      {acciones && <div className="pila" style={{ width: '100%', maxWidth: 320 }}>{acciones}</div>}
    </div>
  );
}

/** Estado "Cargando" del prototipo: esqueletos de tarjetas. */
export function Esqueleto({ filas = 4, texto = 'Cargando…' }: { filas?: number; texto?: string }) {
  return (
    <div className="pila" aria-busy="true">
      <p className="sr" role="status">
        {texto}
      </p>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="fila-entre">
            <div className="skel" style={{ width: '45%', height: 14 }} />
            <div className="skel" style={{ width: 72, height: 22 }} />
          </div>
          <div className="skel" style={{ width: '65%', height: 18 }} />
          <div className="skel" style={{ width: '35%', height: 14 }} />
        </div>
      ))}
    </div>
  );
}

/** Pantallas solo en línea cuando el servidor no está disponible o respondió con error. */
export function ErrorConsulta({ error, reintentar, enLinea }: { error: unknown; reintentar: () => void; enLinea: boolean }) {
  return (
    <EstadoVacio
      icono={enLinea ? CircleAlert : WifiOff}
      titulo={enLinea ? 'No pudimos cargar la información' : 'Esta sección necesita conexión'}
      texto={enLinea ? mensajeError(error) : 'Se consulta directamente en el servidor. Conéctate a Internet para verla.'}
      acciones={
        <button type="button" className="btn btn-q" onClick={reintentar}>
          Intentar nuevamente
        </button>
      }
    />
  );
}

export function AvisoLinea({ tono, icono, children }: { tono: 'info' | 'warn' | 'err' | 'ok'; icono?: ReactNode; children: ReactNode }) {
  return (
    <div className={`aviso-linea ${tono}`} role={tono === 'err' ? 'alert' : undefined}>
      {icono}
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}
