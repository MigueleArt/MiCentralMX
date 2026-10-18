import { useLiveQuery } from 'dexie-react-hooks';
import { CONFIG } from '../config';
import { db } from '../db/db';
import { useConectividad } from '../sync/conectividad';
import { useEstadoMotor } from '../sync/motor';

export type EstadoGlobalSync = 'actualizado' | 'sin_conexion' | 'pendientes' | 'sincronizando' | 'por_revisar' | 'hora_incorrecta' | 'error';

interface DatosEstadoSync {
  enLinea: boolean;
  sincronizando: boolean;
  horaIncorrecta: boolean;
  porRevisar: number;
  pendientes: number;
  error: string | null;
}

export function determinarEstadoSync(d: DatosEstadoSync): EstadoGlobalSync {
  if (!d.enLinea) return 'sin_conexion';
  if (d.sincronizando) return 'sincronizando';
  if (d.horaIncorrecta) return 'hora_incorrecta';
  if (d.porRevisar > 0) return 'por_revisar';
  if (d.pendientes > 0) return 'pendientes';
  if (d.error) return 'error';
  return 'actualizado';
}

/** Resumen para la insignia de sincronización (decisiones técnicas §5). */
export function useResumenSync() {
  const conexion = useConectividad();
  const motor = useEstadoMotor();
  const datos = useLiveQuery(async () => {
    const ops = await db.operaciones.toArray();
    return {
      pendientes: ops.filter((o) => o.estado === 'pendiente' || o.estado === 'enviando').length,
      porRevisar: ops.filter((o) => (o.estado === 'en_revision' || o.estado === 'rechazada') && !o.enteradoEn).length,
      desfase: (await db.leerMeta('desfaseRelojMs')) ?? 0,
      ultimoPull: (await db.leerMeta('ultimoPullFin')) ?? null,
    };
  });
  const pendientes = datos?.pendientes ?? 0;
  const porRevisar = datos?.porRevisar ?? 0;
  const horaIncorrecta = (datos?.desfase ?? 0) > CONFIG.toleranciaRelojMs;

  const estado = determinarEstadoSync({
    enLinea: conexion.enLinea,
    sincronizando: motor.sincronizando,
    horaIncorrecta,
    porRevisar,
    pendientes,
    error: motor.ultimoError,
  });

  return {
    estado,
    pendientes,
    porRevisar,
    horaIncorrecta,
    enLinea: conexion.enLinea,
    ultimoPull: datos?.ultimoPull ?? null,
    error: motor.ultimoError,
  };
}
