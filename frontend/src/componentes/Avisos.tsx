import { CircleAlert, CircleCheck } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Aviso {
  id: number;
  texto: string;
  tipo: 'ok' | 'error';
}

const Contexto = createContext<(texto: string, tipo?: Aviso['tipo']) => void>(() => {});

/** Avisos breves (toast) tras confirmar una acción. */
export function AvisosProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const mostrar = useCallback((texto: string, tipo: Aviso['tipo'] = 'ok') => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a, { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <Contexto.Provider value={mostrar}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {avisos.map((a) => (
            <div key={a.id} className="toast">
              {a.tipo === 'ok' ? (
                <CircleCheck className="ic" style={{ color: '#7fd1a8' }} />
              ) : (
                <CircleAlert className="ic" style={{ color: '#ff9c9c' }} />
              )}
              {a.texto}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Contexto.Provider>
  );
}

export const useAvisos = () => useContext(Contexto);
