import { RefreshCw, Share, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { registerSW } from 'virtual:pwa-register';
import { sincronizar } from '../sync/motor';

const esIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalada = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * Actualización con aviso (registerType: 'prompt'): antes de recargar se sincroniza,
 * y en iPhone se pide instalar en la pantalla de inicio (decisiones técnicas §7).
 */
export function AvisosPwa() {
  const [actualizar, setActualizar] = useState<((recargar?: boolean) => Promise<void>) | null>(null);
  const [verIos, setVerIos] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    // immediate: el efecto corre después del evento load, que registerSW esperaría para siempre.
    const f = registerSW({ immediate: true, onNeedRefresh: () => setActualizar(() => f) });
  }, []);

  useEffect(() => {
    let descartado = false;
    try {
      descartado = localStorage.getItem('mc-ios-instalar') === 'no';
    } catch {
      // Sin almacenamiento: se muestra el aviso.
    }
    if (esIos() && !instalada() && !descartado) setVerIos(true);
  }, []);

  const descartarIos = () => {
    setVerIos(false);
    try {
      localStorage.setItem('mc-ios-instalar', 'no');
    } catch {
      // Ignorado.
    }
  };

  if (!actualizar && !verIos) return null;
  return createPortal(
    <div className="toasts" style={{ bottom: 'calc(var(--nav-alto) + 80px)' }}>
      {actualizar && (
        <div className="toast" style={{ pointerEvents: 'auto' }}>
          <RefreshCw className="ic" />
          <span style={{ flex: 1 }}>Hay una nueva versión.</span>
          <button
            type="button"
            className="btn btn-a btn-sm"
            onClick={async () => {
              try {
                await sincronizar();
              } finally {
                await actualizar(true);
              }
            }}
          >
            Actualizar
          </button>
        </div>
      )}
      {verIos && (
        <div className="toast" style={{ pointerEvents: 'auto', alignItems: 'flex-start' }}>
          <Share className="ic" />
          <span style={{ flex: 1 }}>
            Instala MiCentralMX: toca Compartir y luego “Agregar a inicio”. Sin instalarla, Safari puede borrar los datos guardados después de 7 días sin uso.
          </span>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={descartarIos} style={{ color: '#fff', width: 32, height: 32 }}>
            <X className="ic" />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
