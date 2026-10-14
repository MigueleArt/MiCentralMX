import Decimal from 'decimal.js';

export const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
export const aImporte = (v: Decimal.Value) => D(v).toDecimalPlaces(2).toFixed(2);
export const aCantidad = (v: Decimal.Value) => D(v).toDecimalPlaces(3).toString();
export const sumar = (vs: Decimal.Value[]) => vs.reduce<Decimal>((a, v) => a.plus(v), new Decimal(0));

const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const formatoMXN = (v: Decimal.Value) => fmt.format(D(v).toNumber());

export const folioVenta = (f: number) => `#${String(f).padStart(6, '0')}`;
export const folioCompra = (f: number) => `#C-${String(f).padStart(4, '0')}`;
