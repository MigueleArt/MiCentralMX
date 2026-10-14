import type { Venta } from '@micentralmx/shared/entidades';
import { formatoCantidad } from '../lib/dinero';

export const folioVenta = (v: Pick<Venta, 'folio' | 'folioProvisional'>): string =>
  v.folio != null ? `#${String(v.folio).padStart(6, '0')}` : (v.folioProvisional ?? 'sin folio');

export const folioCompra = (c: { folio: number | null; folioProvisional: string | null }): string =>
  c.folio != null ? `#C-${String(c.folio).padStart(4, '0')}` : (c.folioProvisional ?? 'sin folio');

/** "5 cajas", "1 caja", "12.5 kg" */
export function cantidadConUnidad(cantidad: string | number, unidad: { nombre: string; plural: string }): string {
  const n = Number(cantidad);
  return `${formatoCantidad(cantidad)} ${n === 1 ? unidad.nombre : unidad.plural}`;
}

export const ETIQUETA_FORMA_PAGO = { efectivo: 'Efectivo', transferencia: 'Transferencia', credito: 'Crédito' } as const;
export const ETIQUETA_METODO = { efectivo: 'Efectivo', transferencia: 'Transferencia', otro: 'Otro' } as const;

/** "Contado · Efectivo" / "Crédito · vence 06/10/2026" */
export function textoPagoVenta(v: Pick<Venta, 'formaPago'>): string {
  return v.formaPago === 'credito' ? 'Crédito' : `Contado · ${ETIQUETA_FORMA_PAGO[v.formaPago]}`;
}

export const MOTIVOS_MERMA = ['Producto dañado', 'Maduración excesiva', 'Merma por peso', 'Robo o faltante', 'Otro'] as const;

export const CATEGORIAS_DINERO = {
  pago_proveedor: { tipo: 'egreso', nombre: 'Pago a proveedor' },
  flete: { tipo: 'egreso', nombre: 'Flete de mercancía' },
  sueldo: { tipo: 'egreso', nombre: 'Sueldos' },
  otro_egreso: { tipo: 'egreso', nombre: 'Otro egreso' },
  renta: { tipo: 'ingreso', nombre: 'Renta' },
  otro_ingreso: { tipo: 'ingreso', nombre: 'Otro ingreso' },
} as const;
