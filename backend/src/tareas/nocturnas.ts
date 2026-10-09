/**
 * Tareas nocturnas (decisiones técnicas §4.4): conciliación de existencias contra el historial
 * y limpieza de intentos de login vencidos. Corren a las 03:00 de la zona del negocio.
 *
 * Con varias instancias de la API, un advisory lock de PostgreSQL garantiza que solo una las ejecute.
 * También se pueden lanzar desde un cron externo con `npm run tareas:nocturnas`.
 */
import pg from 'pg';
import { config } from '../config';

const CANDADO = 727_100_001; // Identificador fijo del advisory lock de estas tareas.

export interface ResultadoNocturnas {
  ejecutada: boolean;
  alertasAbiertas: number;
  alertasCerradas: number;
  intentosBorrados: number;
}

/** Ejecuta las tareas con mc_plataforma (abarca todos los negocios). */
export async function ejecutarNocturnas(url = config.databasePlataformaUrl): Promise<ResultadoNocturnas> {
  if (!url) throw new Error('Falta DATABASE_PLATAFORMA_URL para las tareas nocturnas.');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const { rows } = await c.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [CANDADO]);
    if (!rows[0].ok) return { ejecutada: false, alertasAbiertas: 0, alertasCerradas: 0, intentosBorrados: 0 };
    try {
      const r = await c.query<{ abiertas: number; cerradas: number }>('select * from conciliar_existencias()');
      const borrados = await c.query("delete from intentos_login where ventana_hasta < now() - interval '1 day'");
      return { ejecutada: true, alertasAbiertas: r.rows[0].abiertas, alertasCerradas: r.rows[0].cerradas, intentosBorrados: borrados.rowCount ?? 0 };
    } finally {
      await c.query('select pg_advisory_unlock($1)', [CANDADO]);
    }
  } finally {
    await c.end();
  }
}

/** Milisegundos hasta la próxima hora indicada en la zona del negocio. */
export function msHasta(hora: number, ahora = new Date(), zona: string = config.zonaHoraria): number {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'longOffset' })
      .formatToParts(ahora)
      .map((p) => [p.type, p.value]),
  );
  const offset = String(partes.timeZoneName).replace('GMT', '') || '+00:00';
  let objetivo = new Date(`${partes.year}-${partes.month}-${partes.day}T${String(hora).padStart(2, '0')}:00:00${offset}`);
  if (objetivo.getTime() <= ahora.getTime()) objetivo = new Date(objetivo.getTime() + 86_400_000);
  return objetivo.getTime() - ahora.getTime();
}

/** Programa la ejecución diaria dentro del proceso de la API. Devuelve la función para detenerla. */
export function programarNocturnas(hora = 3): () => void {
  if (!config.databasePlataformaUrl) {
    console.warn('Tareas nocturnas desactivadas: falta DATABASE_PLATAFORMA_URL.');
    return () => {};
  }
  let temporizador: NodeJS.Timeout;
  const siguiente = () => {
    temporizador = setTimeout(async () => {
      try {
        const r = await ejecutarNocturnas();
        if (r.ejecutada) console.log(`Conciliación: ${r.alertasAbiertas} alertas abiertas, ${r.alertasCerradas} cerradas.`);
      } catch (e) {
        console.error('Falló la tarea nocturna', e);
      }
      siguiente();
    }, msHasta(hora));
    temporizador.unref();
  };
  siguiente();
  return () => clearTimeout(temporizador);
}
