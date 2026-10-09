import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Permiso } from '@micentralmx/shared/permisos';
import { db, type DispositivoLocal, type SesionLocal } from '../db/db';
import { estadoVentana, tienePermiso } from './sesion';

interface ValorSesion {
  cargando: boolean;
  sesion: SesionLocal | null;
  dispositivo: DispositivoLocal | null;
  /** Ventana offline vencida: solo lectura hasta reconectar (decisiones técnicas §4.3). */
  soloLectura: boolean;
  venceEn: Date | null;
  puede: (p: Permiso) => boolean;
}

const Contexto = createContext<ValorSesion | null>(null);

export function SesionProvider({ children }: { children: ReactNode }) {
  const datos = useLiveQuery(async () => ({
    sesion: (await db.leerMeta('sesion')) ?? null,
    dispositivo: (await db.leerMeta('dispositivo')) ?? null,
    ultimoContacto: await db.leerMeta('ultimoContacto'),
  }));
  // Reevalúa la ventana cada minuto aunque no cambie la base.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const sesion = datos?.sesion ?? null;
  const ventana = sesion ? estadoVentana(sesion, datos?.ultimoContacto, ahora) : null;
  const valor: ValorSesion = {
    cargando: datos === undefined,
    sesion,
    dispositivo: datos?.dispositivo ?? null,
    soloLectura: ventana?.soloLectura ?? false,
    venceEn: ventana?.venceEn ?? null,
    puede: (p) => tienePermiso(sesion?.usuario, p),
  };
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): ValorSesion {
  const v = useContext(Contexto);
  if (!v) throw new Error('useSesion requiere SesionProvider');
  return v;
}

/** Sesión garantizada (dentro de rutas protegidas). */
export function useSesionActiva() {
  const v = useSesion();
  if (!v.sesion) throw new Error('Sin sesión activa');
  return { ...v, sesion: v.sesion };
}
