/**
 * Entidades que comparten el dispositivo y el servidor.
 * Importes y cantidades son texto (NUMERIC); fechas, ISO 8601; días, AAAA-MM-DD.
 * Cuando exista `packages/shared`, este archivo se mueve ahí sin cambios.
 */
import type { Permiso } from './permisos';

export interface Unidad {
  id: string;
  nombre: string;
  plural: string;
  permiteDecimales: boolean;
  archivadoEn: string | null;
}

export interface Producto {
  id: string;
  nombre: string;
  unidadId: string;
  /** Aviso de inventario bajo, aplicado a cada clasificación. */
  umbralBajo: string;
  archivadoEn: string | null;
}

export interface Clasificacion {
  id: string;
  productoId: string;
  nombre: string;
  precio: string;
  /** Último costo de compra: precio de referencia de compra y valor de mermas. */
  ultimoCosto: string | null;
  orden: number;
  archivadoEn: string | null;
}

/** Existencia confirmada por el servidor (snapshot). */
export interface Existencia {
  clasificacionId: string;
  cantidad: string;
}

export interface Cliente {
  id: string;
  nombre: string;
  telefono: string | null;
  ubicacion: string | null;
  plazoDias: number | null;
  saldoAFavor: string;
  creadoEn: string;
  archivadoEn: string | null;
  requiereRevision: boolean;
}

export type TipoProveedor = 'tercero' | 'rancho_propio';

export type ComisionTipoBase = 'porcentaje' | 'por_unidad';
export type ComisionTipo = 'porcentaje' | 'por_unidad' | 'mixta';

export interface Proveedor {
  id: string;
  nombre: string;
  telefono: string | null;
  productos: string;
  tipo: TipoProveedor;
  comisionTipo?: ComisionTipoBase | null;
  comisionValor?: string | null;
  archivadoEn: string | null;
}

export type EstadoCarga = 'abierta' | 'cerrada';

export interface RenglonCarga {
  cargaId?: string;
  linea: number;
  clasificacionId: string;
  cantidad: string;
}

export interface Carga {
  id: string;
  fecha: string;
  proveedorId: string;
  proveedorNombre?: string;
  proveedorTipo?: TipoProveedor;
  estado: EstadoCarga;
  comisionTipo?: ComisionTipoBase | null;
  comisionValor?: string | null;
  renglones: RenglonCarga[];
  usuarioId: string;
  usuarioNombre: string;
  dispositivoId: string;
  creadoEnDispositivo: string;
  cerradaEn: string | null;
}

export interface ExistenciaCarga {
  id?: string;
  cargaId: string;
  clasificacionId: string;
  cantidad: string;
}

export type FormaPago = 'efectivo' | 'transferencia' | 'credito';
export type EstadoVenta = 'completada' | 'por_confirmar' | 'a_credito' | 'cancelada';

export interface RenglonVenta {
  clasificacionId: string;
  productoId: string;
  productoNombre: string;
  clasificacionNombre: string;
  unidadNombre: string;
  unidadPlural: string;
  cantidad: string;
  precio: string;
  precioReferencia: string;
  importe: string;
  cargaId?: string | null;
  origenNombre?: string | null;
}

export interface Venta {
  id: string;
  /** Folio definitivo de un bloque reservado; nunca cambia. */
  folio: number | null;
  /** Solo si el dispositivo agotó su bloque sin conexión: D3-P0001. */
  folioProvisional: string | null;
  clienteId: string | null;
  clienteNombre: string | null;
  formaPago: FormaPago;
  estado: EstadoVenta;
  renglones: RenglonVenta[];
  total: string;
  /** Pagado según el servidor. Los pagos locales pendientes se suman aparte. */
  pagado: string;
  venceEl: string | null;
  usuarioId: string;
  usuarioNombre: string;
  dispositivoId: string;
  creadoEnDispositivo: string;
  requiereRevision: boolean;
  motivoRevision: string | null;
  canceladaEn: string | null;
}

export type MetodoPago = 'efectivo' | 'transferencia' | 'otro';

export interface AplicacionPago {
  ventaId: string;
  monto: string;
}

export interface Pago {
  id: string;
  clienteId: string;
  clienteNombre: string;
  monto: string;
  metodo: MetodoPago;
  nota: string | null;
  aplicaciones: AplicacionPago[];
  /** Lo que excede las deudas: saldo a favor, siempre con revisión. */
  excedente: string;
  usuarioId: string;
  usuarioNombre: string;
  creadoEnDispositivo: string;
  requiereRevision: boolean;
}

export interface RenglonCompra {
  clasificacionId: string;
  productoId: string;
  productoNombre: string;
  clasificacionNombre: string;
  unidadNombre: string;
  unidadPlural: string;
  cantidad: string;
  costo: string;
  importe: string;
}

export interface Compra {
  id: string;
  folio: number | null;
  folioProvisional: string | null;
  proveedorId: string;
  proveedorNombre: string;
  renglones: RenglonCompra[];
  total: string;
  formaPago: 'contado' | 'credito';
  venceEl: string | null;
  usuarioId: string;
  usuarioNombre: string;
  creadoEnDispositivo: string;
}

export type TipoMovimientoInventario = 'inicial' | 'compra' | 'venta' | 'merma' | 'ajuste' | 'cancelacion' | 'carga' | 'devolucion';

export interface MovimientoInventario {
  id: string;
  clasificacionId: string;
  productoId: string;
  delta: string;
  tipo: TipoMovimientoInventario;
  referencia: string | null;
  motivo: string | null;
  cargaId?: string | null;
  usuarioNombre: string;
  creadoEn: string;
}

export type CategoriaDinero = 'pago_proveedor' | 'anticipo_productor' | 'flete' | 'renta' | 'sueldo' | 'otro_egreso' | 'otro_ingreso';

export interface MovimientoDinero {
  id: string;
  tipo: 'ingreso' | 'egreso';
  categoria: CategoriaDinero;
  concepto: string;
  monto: string;
  metodo: MetodoPago;
  proveedorId: string | null;
  compraId?: string | null;
  usuarioNombre: string;
  creadoEn: string;
}

export interface UsuarioSesion {
  id: string;
  nombre: string;
  usuario: string;
  rolId: string;
  rolNombre: string;
  rolBase: string | null;
  permisos: Permiso[];
}

export interface Negocio {
  id: string;
  nombre: string;
  telefono: string | null;
  ubicacion: string | null;
}

export interface ConfiguracionNegocio {
  ventanaOfflineHoras: number;
  plazoCreditoDias: number;
}

export type TipoConceptoLiquidacion = 'flete' | 'tara' | 'merma' | 'otro';

export interface LiquidacionRenglon {
  id?: string;
  liquidacionId: string;
  ventaId: string;
  linea: number;
  cargaId: string | null;
  importe: string;
  unidades: string;
}

export interface LiquidacionConcepto {
  id?: string;
  liquidacionId: string;
  linea: number;
  tipo: TipoConceptoLiquidacion;
  concepto: string;
  monto: string;
  movimientoId?: string | null;
}

export interface Liquidacion {
  id: string;
  folio: number;
  proveedorId: string;
  periodoDesde: string | null;
  periodoHasta: string | null;
  totalVendido: string;
  unidadesVendidas: string;
  comisionTipo: ComisionTipo;
  comisionValor: string;
  comisionCalculada: string;
  comisionFinal: string;
  comisionNota: string | null;
  descuentosTotal: string;
  neto: string;
  usuarioId: string;
  usuarioNombre: string;
  creadoEn: string;
  renglones?: LiquidacionRenglon[];
  conceptos?: LiquidacionConcepto[];
}

export type TipoAjusteProductor = 'cargo' | 'abono';
export type CategoriaAjusteProductor = 'cancelacion' | 'incobrable' | 'otro';

export interface AjusteProductor {
  id: string;
  proveedorId: string;
  tipo: TipoAjusteProductor;
  categoria: CategoriaAjusteProductor;
  concepto: string;
  monto: string;
  ventaId: string | null;
  usuarioId: string;
  usuarioNombre: string;
  creadoEn: string;
}
