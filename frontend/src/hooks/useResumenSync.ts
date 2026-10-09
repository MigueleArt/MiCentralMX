import { useLiveQuery } from 'dexie-react-hooks';
import { CONFIG } from '../config';
import { db } from '../db/db';
import { useConectividad } from '../sync/conectividad';
import { useEstadoMotor } from '../sync/motor';

export type EstadoGlobalSync = 'actualizado' | 'sin_conexion' | 'pendientes' | 'sincronizando' | 'por_revisar' | 'hora_incorrecta' | 'error';

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

  let estado: EstadoGlobalSync = 'actualizado';
  if (!conexion.enLinea) estado = 'sin_conexion';
  else if (motor.sincronizando) estado = 'sincronizando';
  else if (horaIncorrecta) estado = 'hora_incorrecta';
  else if (porRevisar > 0) estado = 'por_revisar';
  else if (pendientes > 0) estado = 'pendientes';
  else if (motor.ultimoError) estado = 'error';

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
