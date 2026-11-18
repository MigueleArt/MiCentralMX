import Decimal from 'decimal.js';

/**
 * Importes y cantidades viajan y se guardan como texto (NUMERIC en PostgreSQL)
 * y se operan con decimal.js para evitar errores de redondeo de `number`.
 */
export const D = (v: Decimal.Value | null | undefined): Decimal => new Decimal(v ?? 0);

export function sumar(valores: Array<Decimal.Value>): Decimal {
  return valores.reduce<Decimal>((acc, v) => acc.plus(v), new Decimal(0));
}

/** Importe a texto con 2 decimales, listo para guardar o enviar. */
export const aImporte = (v: Decimal.Value): string => D(v).toDecimalPlaces(2).toFixed(2);
/** Cantidad a texto con 3 decimales máximo, sin ceros sobrantes. */
export const aCantidad = (v: Decimal.Value): string => D(v).toDecimalPlaces(3).toString();

const fmtEntero = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0, minimumFractionDigits: 0 });
const fmtCentavos = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** $1,700 si es entero; $1,700.50 si tiene centavos (decisiones técnicas §7). */
export function formatoMXN(v: Decimal.Value): string {
  const d = D(v);
  return d.isInteger() ? fmtEntero.format(d.toNumber()) : fmtCentavos.format(d.toNumber());
}

/** Con signo explícito para movimientos: +$1,500 / −$18,000. */
export function formatoMXNSigno(v: Decimal.Value): string {
  const d = D(v);
  if (d.isZero()) return formatoMXN(0);
  return (d.isNegative() ? '−' : '+') + formatoMXN(d.abs());
}

const fmtCant = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 });
export const formatoCantidad = (v: Decimal.Value): string => fmtCant.format(D(v).toNumber());

/** Interpreta lo que escribe el usuario: "$1,500.50" → "1500.50". Devuelve null si no es número. */
export function leerNumero(texto: string): string | null {
  const limpio = texto.replace(/[$,\s]/g, '');
  if (limpio === '' || !/^\d*\.?\d*$/.test(limpio) || limpio === '.') return null;
  return D(limpio).toString();
}
