import type {
  AjusteProductor,
  Carga,
  Cliente,
  Clasificacion,
  Compra,
  Existencia,
  ExistenciaCarga,
  Liquidacion,
  LiquidacionConcepto,
  LiquidacionRenglon,
  MovimientoDinero,
  MovimientoInventario,
  Pago,
  Producto,
  Proveedor,
  RenglonCarga,
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
  tipo: r.tipo ?? 'tercero',
  comisionTipo: r.comisionTipo ?? null,
  comisionValor: r.comisionValor ?? null,
  archivadoEn: iso(r.archivadoEn),
});

export const renglonCarga = (r: Fila<typeof e.cargaRenglones>): RenglonCarga => ({
  linea: r.linea,
  clasificacionId: r.clasificacionId,
  cantidad: r.cantidad,
});

export const carga = (r: Fila<typeof e.cargas>, renglones: RenglonCarga[]): Carga => ({
  id: r.id,
  fecha: r.fecha,
  proveedorId: r.proveedorId,
  estado: r.estado,
  renglones,
  usuarioId: r.usuarioId,
  usuarioNombre: r.usuarioNombre,
  comisionTipo: r.comisionTipo ?? null,
  comisionValor: r.comisionValor ?? null,
  dispositivoId: r.dispositivoId ?? 'servidor',
  creadoEnDispositivo: r.creadoEnDispositivo.toISOString(),
  cerradaEn: iso(r.cerradaEn),
});

export const existenciaCarga = (r: Fila<typeof e.existenciasCarga>): ExistenciaCarga => ({
  id: r.id,
  cargaId: r.cargaId,
  clasificacionId: r.clasificacionId,
  cantidad: r.cantidad,
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
  cargaId: r.cargaId ?? null,
  origenNombre: r.origenNombre ?? null,
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
  cargaId: r.cargaId ?? null,
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
  compraId: r.compraId ?? null,
  usuarioNombre: r.usuarioNombre,
  creadoEn: r.creadoEn.toISOString(),
});

export const liquidacionRenglon = (r: Fila<typeof e.liquidacionRenglones>): LiquidacionRenglon => ({
  id: `${r.liquidacionId}:${r.linea}`,
  liquidacionId: r.liquidacionId,
  linea: r.linea,
  ventaId: r.ventaId,
  cargaId: r.cargaId ?? null,
  importe: r.importe,
  unidades: r.unidades,
});

export const liquidacionConcepto = (r: Fila<typeof e.liquidacionConceptos>): LiquidacionConcepto => ({
  id: `${r.liquidacionId}:${r.linea}`,
  liquidacionId: r.liquidacionId,
  linea: r.linea,
  tipo: r.tipo,
  concepto: r.concepto,
  monto: r.monto,
  movimientoId: r.movimientoId ?? null,
});

export const liquidacion = (
  r: Fila<typeof e.liquidaciones>,
  renglones: LiquidacionRenglon[] = [],
  conceptos: LiquidacionConcepto[] = [],
): Liquidacion => ({
  id: r.id,
  folio: r.folio,
  proveedorId: r.proveedorId,
  periodoDesde: r.periodoDesde,
  periodoHasta: r.periodoHasta,
  totalVendido: r.totalVendido,
  unidadesVendidas: r.unidadesVendidas,
  comisionTipo: r.comisionTipo,
  comisionValor: r.comisionValor,
  comisionCalculada: r.comisionCalculada,
  comisionFinal: r.comisionFinal,
  comisionNota: r.comisionNota,
  descuentosTotal: r.descuentosTotal,
  neto: r.neto,
  usuarioId: r.usuarioId,
  usuarioNombre: r.usuarioNombre,
  creadoEn: r.creadoEn.toISOString(),
  renglones,
  conceptos,
});

export const ajusteProductor = (r: Fila<typeof e.ajustesProductor>): AjusteProductor => ({
  id: r.id,
  proveedorId: r.proveedorId,
  tipo: r.tipo,
  categoria: r.categoria,
  concepto: r.concepto,
  monto: r.monto,
  ventaId: r.ventaId,
  usuarioId: r.usuarioId,
  usuarioNombre: r.usuarioNombre,
  creadoEn: r.creadoEn.toISOString(),
});

