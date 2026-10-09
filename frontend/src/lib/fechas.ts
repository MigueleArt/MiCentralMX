import { CONFIG } from '../config';

const zona = CONFIG.zonaHoraria;
const fmtFecha = new Intl.DateTimeFormat('es-MX', { timeZone: zona, day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtHora = new Intl.DateTimeFormat('es-MX', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtDia = new Intl.DateTimeFormat('es-MX', { timeZone: zona, weekday: 'long' });
const fmtMesAnio = new Intl.DateTimeFormat('es-MX', { timeZone: zona, month: '2-digit', year: 'numeric' });
const fmtIso = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' });

const aFecha = (v: string | Date) => (typeof v === 'string' ? new Date(v) : v);

/** 01/10/2026 */
export const formatoFecha = (v: string | Date) => fmtFecha.format(aFecha(v));
/** 16:05 */
export const formatoHora = (v: string | Date) => fmtHora.format(aFecha(v));
/** 01/10/2026 · 16:05 */
export const formatoFechaHora = (v: string | Date) => `${formatoFecha(v)} · ${formatoHora(v)}`;
/** 03/2025 */
export const formatoMesAnio = (v: string | Date) => fmtMesAnio.format(aFecha(v));
/** Jueves 01/10/2026 */
export function formatoDiaFecha(v: string | Date = new Date()): string {
  const dia = fmtDia.format(aFecha(v));
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${formatoFecha(v)}`;
}

/** Día calendario en la zona del negocio, AAAA-MM-DD. */
export const diaLocal = (v: string | Date = new Date()) => fmtIso.format(aFecha(v));

export const ahoraIso = () => new Date().toISOString();

/** Suma días a un día AAAA-MM-DD. */
export function sumarDias(dia: string, dias: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + dias));
  return f.toISOString().slice(0, 10);
}

/** Diferencia en días calendario: b − a (ambos AAAA-MM-DD). */
export function diferenciaDias(a: string, b: string): number {
  const fa = Date.UTC(...(a.split('-').map(Number) as [number, number, number]));
  const fb = Date.UTC(...(b.split('-').map(Number) as [number, number, number]));
  return Math.round((fb - fa) / 86_400_000);
}

/** Fecha de un día AAAA-MM-DD en formato DD/MM/AAAA. */
export function formatoDia(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/** "Hoy 15:30", "Ayer", o la fecha. */
export function formatoRelativo(v: string): string {
  const dia = diaLocal(v);
  const hoy = diaLocal();
  if (dia === hoy) return `Hoy ${formatoHora(v)}`;
  if (diferenciaDias(dia, hoy) === 1) return 'Ayer';
  return formatoFecha(v);
}

/** "hace 16 días" / "en 5 días" / "hoy" respecto a hoy. */
export function textoDias(dia: string): string {
  const dif = diferenciaDias(diaLocal(), dia);
  if (dif === 0) return 'hoy';
  if (dif === 1) return 'mañana';
  if (dif === -1) return 'ayer';
  return dif > 0 ? `en ${dif} días` : `hace ${-dif} días`;
}

/** "hace 10 min", "ayer", etc. para la última actividad. */
export function haceCuanto(v: string): string {
  const min = Math.round((Date.now() - new Date(v).getTime()) / 60_000);
  if (min < 2) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24 && diaLocal(v) === diaLocal()) return `hace ${h} h`;
  return diferenciaDias(diaLocal(v), diaLocal()) === 1 ? 'ayer' : formatoFecha(v);
}
