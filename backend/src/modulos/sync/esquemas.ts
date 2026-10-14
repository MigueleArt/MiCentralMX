/**
 * Validación en el servidor de lo que llega en /sync/push. Solo se toman los datos de captura;
 * importes, totales, nombres y estados se recalculan aquí (no se confía en el dispositivo).
 */
import { z } from 'zod';

const decimal = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d+)?$/.test(v), 'debe ser un número positivo');
const fecha = z.iso.datetime({ offset: true });
const dia = z.iso.date();
const id = z.uuid();

export const esquemaVenta = z.object({
  id,
  folio: z.number().int().positive().nullable(),
  folioProvisional: z.string().max(40).nullable(),
  clienteId: id.nullable(),
  formaPago: z.enum(['efectivo', 'transferencia', 'credito']),
  venceEl: dia.nullable(),
  motivoRevision: z.string().max(500).nullable().optional(),
  renglones: z
    .array(z.object({ clasificacionId: id, cantidad: decimal, precio: decimal, precioReferencia: decimal }))
    .min(1)
    .max(50),
});

export const esquemaPago = z.object({
  id,
  clienteId: id,
  monto: decimal,
  metodo: z.enum(['efectivo', 'transferencia', 'otro']),
  nota: z.string().max(500).nullable(),
  aplicaciones: z.array(z.object({ ventaId: id, monto: decimal })).max(50),
});

export const esquemaCompra = z.object({
  id,
  folio: z.number().int().positive().nullable(),
  folioProvisional: z.string().max(40).nullable(),
  proveedorId: id,
  formaPago: z.enum(['contado', 'credito']),
  venceEl: dia.nullable(),
  renglones: z.array(z.object({ clasificacionId: id, cantidad: decimal, costo: decimal })).min(1).max(50),
});

export const esquemaMerma = z.object({
  id,
  clasificacionId: id,
  cantidad: decimal,
  motivo: z.string().min(1).max(120),
  nota: z.string().max(500).nullable(),
});

export const esquemaCliente = z.object({
  id,
  nombre: z.string().trim().min(2).max(160),
  telefono: z.string().max(30).nullable(),
  ubicacion: z.string().max(200).nullable(),
  plazoDias: z.number().int().min(1).max(120).nullable(),
  creadoEn: fecha,
});

export const CATEGORIAS = {
  pago_proveedor: 'egreso',
  flete: 'egreso',
  sueldo: 'egreso',
  otro_egreso: 'egreso',
  renta: 'ingreso',
  otro_ingreso: 'ingreso',
} as const;

export const esquemaMovimientoDinero = z.object({
  id,
  categoria: z.enum(Object.keys(CATEGORIAS) as [keyof typeof CATEGORIAS, ...Array<keyof typeof CATEGORIAS>]),
  concepto: z.string().max(200),
  monto: decimal,
  metodo: z.enum(['efectivo', 'transferencia', 'otro']),
  proveedorId: id.nullable(),
  creadoEn: fecha,
});

export const TIPOS_OPERACION = ['venta.crear', 'pago.crear', 'compra.crear', 'merma.crear', 'cliente.crear', 'movimiento_dinero.crear'] as const;

export const esquemaPush = z.object({
  dispositivo_id: id,
  reloj_dispositivo: fecha,
  version_contrato: z.number().int(),
  operaciones: z
    .array(
      z.object({
        operacion_id: id,
        tipo: z.string(),
        usuario_id: id,
        creado_en_dispositivo: fecha,
        hash: z.string().min(16).max(128),
        datos: z.unknown(),
      }),
    )
    .max(50),
});
export type OperacionEntrante = z.infer<typeof esquemaPush>['operaciones'][number];
