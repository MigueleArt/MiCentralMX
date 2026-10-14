import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

function useCerrarConEscape(cerrar: () => void) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && cerrar();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [cerrar]);
}

function useEnfocar<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previo?.focus?.();
  }, []);
  return ref;
}

/** Hoja inferior en teléfono; en tablet y PC se centra como modal (layout.css). */
export function HojaInferior({
  titulo,
  subtitulo,
  alCerrar,
  children,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  alCerrar: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const ref = useEnfocar<HTMLDivElement>();
  useCerrarConEscape(alCerrar);
  return createPortal(
    <>
      <div className="scrim" onClick={alCerrar} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="grab" />
        <div className="fila-entre" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <h2 id={id} className="t-sec">
              {titulo}
            </h2>
            {subtitulo && <p className="t-2 num">{subtitulo}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={alCerrar} style={{ marginRight: -8, marginTop: -6 }}>
            <X className="ic" />
          </button>
        </div>
        {children}
      </div>
    </>,
    document.body,
  );
}

export function Dialogo({
  titulo,
  icono,
  tono = 'neutro',
  alCerrar,
  children,
  acciones,
}: {
  titulo: string;
  icono?: ReactNode;
  tono?: 'neutro' | 'peligro' | 'aviso';
  alCerrar: () => void;
  children?: ReactNode;
  acciones: ReactNode;
}) {
  const id = useId();
  const ref = useEnfocar<HTMLDivElement>();
  useCerrarConEscape(alCerrar);
  const fondo = { neutro: 'var(--color-primario-suave)', peligro: 'var(--error-fondo)', aviso: 'var(--aviso-fondo)' }[tono];
  const color = { neutro: 'var(--color-primario)', peligro: 'var(--error-texto)', aviso: 'var(--aviso-texto)' }[tono];
  return createPortal(
    <>
      <div className="scrim" onClick={alCerrar} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        {icono && (
          <span className="cuadro-ic" style={{ width: 48, height: 48, borderRadius: 12, background: fondo, color }}>
            {icono}
          </span>
        )}
        <div className="pila">
          <h2 id={id} className="t-sec">
            {titulo}
          </h2>
          {children}
        </div>
        <div className="pila">{acciones}</div>
      </div>
    </>,
    document.body,
  );
}
