/** Filas de la base → entidades del contrato (camelCase, fechas ISO, sin negocio ni tx_id). */
import type {
  Cliente,
  Clasificacion,
  Compra,
  Existencia,
  MovimientoDinero,
  MovimientoInventario,
  Pago,
  Producto,
  Proveedor,
  RenglonCompra,
  RenglonVenta,
  Unidad,
  Venta,
} from '@micentralmx/shared/entidades';
import type * as e from '../db/esquema';

type Fila<T extends { $inferSelect: unknown }> = T['$inferSelect'];
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const unidad = (r: Fila<typeof e.unidades>): Unidad => ({
  id: r.id,
  nombre: r.nombre,
  plural: r.plural,
  permiteDecimales: r.permiteDecimales,
  archivadoEn: iso(r.archivadoEn),
});

export const producto = (r: Fila<typeof e.productos>): Producto => ({
  id: r.id,
  nombre: r.nombre,
  unidadId: r.unidadId,
  umbralBajo: r.umbralBajo,
  archivadoEn: iso(r.archivadoEn),
});

export const clasificacion = (r: Fila<typeof e.clasificaciones>): Clasificacion => ({
  id: r.id,
  productoId: r.productoId,
  nombre: r.nombre,
  precio: r.precio,
  ultimoCosto: r.ultimoCosto,
  orden: r.orden,
  archivadoEn: iso(r.archivadoEn),
});

export const existencia = (r: Fila<typeof e.existencias>): Existencia => ({ clasificacionId: r.clasificacionId, cantidad: r.cantidad });

export const cliente = (r: Fila<typeof e.clientes>): Cliente => ({
  id: r.id,
  nombre: r.nombre,
  telefono: r.telefono,
  ubicacion: r.ubicacion,
  plazoDias: r.plazoDias,
  saldoAFavor: r.saldoAFavor,
  creadoEn: r.creadoEn.toISOString(),
  archivadoEn: iso(r.archivadoEn),
  requiereRevision: r.requiereRevision,
});

export const proveedor = (r: Fila<typeof e.proveedores>): Proveedor => ({
  id: r.id,
  nombre: r.nombre,
  telefono: r.telefono,
  productos: r.productos,
  archivadoEn: iso(r.archivadoEn),
});

export const renglonVenta = (r: Fila<typeof e.ventaRenglones>): RenglonVenta => ({
  clasificacionId: r.clasificacionId,
  productoId: r.productoId,
  productoNombre: r.productoNombre,
  clasificacionNombre: r.clasificacionNombre,
  unidadNombre: r.unidadNombre,
  unidadPlural: r.unidadPlural,
  cantidad: r.cantidad,
  precio: r.precio,
  precioReferencia: r.precioReferencia,
  importe: r.importe,
});

export const venta = (r: Fila<typeof e.ventas>, renglones: RenglonVenta[]): Venta => ({
  id: r.id,
  folio: r.folio,
  folioProvisional: r.folioProvisional,
  clienteId: r.clienteId,
  clienteNombre: r.clienteNombre,
  formaPago: r.formaPago,
  estado: r.estado,
  renglones,
  total: r.total,
  pagado: r.pagado,
  venceEl: r.venceEl,
  usuarioId: r.usuarioId,
  usuarioNombre: r.usuarioNombre,
  dispositivoId: r.dispositivoId ?? 'servidor',
  creadoEnDispositivo: r.creadoEnDispositivo.toISOString(),
  requiereRevision: r.requiereRevision,
  motivoRevision: r.motivoRevision,
  canceladaEn: iso(r.canceladaEn),
});

export const pago = (r: Fila<typeof e.pagos>, aplicaciones: Pago['aplicaciones']): Pago => ({
  id: r.id,
  clienteId: r.clienteId,
  clienteNombre: r.clienteNombre,
  monto: r.monto,
  metodo: r.metodo,
  nota: r.nota,
  aplicaciones,
  excedente: r.excedente,
  usuarioId: r.usuarioId,
  usuarioNombre: r.usuarioNombre,
  creadoEnDispositivo: r.creadoEnDispositivo.toISOString(),
  requiereRevision: r.requiereRevision,
});

export const renglonCompra = (r: Fila<typeof e.compraRenglones>): RenglonCompra => ({
  clasificacionId: r.clasificacionId,
  productoId: r.productoId,
  productoNombre: r.productoNombre,
  clasificacionNombre: r.clasificacionNombre,
  unidadNombre: r.unidadNombre,
  unidadPlural: r.unidadPlural,
  cantidad: r.cantidad,
  costo: r.costo,
  importe: r.importe,
});

export const compra = (r: Fila<typeof e.compras>, renglones: RenglonCompra[]): Compra => ({
  id: r.id,
  folio: r.folio,
  folioProvisional: r.folioProvisional,
  proveedorId: r.proveedorId,
  proveedorNombre: r.proveedorNombre,
  renglones,
  total: r.total,
  formaPago: r.formaPago,
  venceEl: r.venceEl,
  usuarioId: r.usuarioId,
  usuarioNombre: r.usuarioNombre,
  creadoEnDispositivo: r.creadoEnDispositivo.toISOString(),
});

export const movimientoInventario = (r: Fila<typeof e.movimientosInventario>): MovimientoInventario => ({
  id: r.id,
  clasificacionId: r.clasificacionId,
  productoId: r.productoId,
  delta: r.delta,
  tipo: r.tipo,
  referencia: r.referencia,
  motivo: r.motivo,
  usuarioNombre: r.usuarioNombre,
  creadoEn: r.creadoEn.toISOString(),
});

export const movimientoDinero = (r: Fila<typeof e.movimientosDinero>): MovimientoDinero => ({
  id: r.id,
  tipo: r.tipo,
  categoria: r.categoria as MovimientoDinero['categoria'],
  concepto: r.concepto,
  monto: r.monto,
  metodo: r.metodo,
  proveedorId: r.proveedorId,
  usuarioNombre: r.usuarioNombre,
  creadoEn: r.creadoEn.toISOString(),
});
