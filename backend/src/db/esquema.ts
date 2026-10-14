/**
 * Esquema Drizzle: espejo tipado de database/migraciones (la fuente de verdad es el SQL,
 * que además define RLS, triggers y funciones). Columnas en snake_case, propiedades en camelCase.
 */
import { bigint, boolean, customType, date, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const xid8 = customType<{ data: string }>({ dataType: () => 'xid8' });
const ts = (n: string) => timestamp(n, { withTimezone: true, mode: 'date' });
const importe = (n: string) => numeric(n, { precision: 12, scale: 2 });
const cantidad = (n: string) => numeric(n, { precision: 12, scale: 3 });

export const negocios = pgTable('negocios', {
  id: uuid('id').primaryKey(),
  nombre: text('nombre').notNull(),
  ubicacion: text('ubicacion'),
  ventanaOfflineHoras: integer('ventana_offline_horas').notNull(),
  plazoCreditoDias: integer('plazo_credito_dias').notNull(),
  creadoEn: ts('creado_en').notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
  base: text('base'),
  permisos: text('permisos').array().notNull(),
  editable: boolean('editable').notNull(),
});

export const usuarios = pgTable('usuarios', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
  usuario: text('usuario').notNull(),
  contrasenaHash: text('contrasena_hash').notNull(),
  rolId: uuid('rol_id').notNull(),
  activo: boolean('activo').notNull(),
  ultimaActividad: ts('ultima_actividad'),
  creadoEn: ts('creado_en').notNull().defaultNow(),
});

export const sesionesRefresh = pgTable('sesiones_refresh', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  usuarioId: uuid('usuario_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiraEn: ts('expira_en').notNull(),
  revocadoEn: ts('revocado_en'),
});

export const dispositivos = pgTable('dispositivos', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  usuarioId: uuid('usuario_id').notNull(),
  codigo: text('codigo').notNull(),
  nombre: text('nombre'),
  creadoEn: ts('creado_en').notNull().defaultNow(),
});

export const contadores = pgTable(
  'contadores',
  {
    negocioId: uuid('negocio_id').notNull(),
    clave: text('clave').notNull(),
    valor: bigint('valor', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.negocioId, t.clave] })],
);

export const bloquesFolio = pgTable('bloques_folio', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  dispositivoId: uuid('dispositivo_id').notNull(),
  tipo: text('tipo').$type<'venta' | 'compra'>().notNull(),
  desde: bigint('desde', { mode: 'number' }).notNull(),
  hasta: bigint('hasta', { mode: 'number' }).notNull(),
});

export const unidades = pgTable('unidades', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
  plural: text('plural').notNull(),
  permiteDecimales: boolean('permite_decimales').notNull(),
  archivadoEn: ts('archivado_en'),
  txId: xid8('tx_id'),
});

export const productos = pgTable('productos', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
  unidadId: uuid('unidad_id').notNull(),
  umbralBajo: cantidad('umbral_bajo').notNull(),
  archivadoEn: ts('archivado_en'),
  txId: xid8('tx_id'),
});

export const clasificaciones = pgTable('clasificaciones', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  productoId: uuid('producto_id').notNull(),
  nombre: text('nombre').notNull(),
  precio: importe('precio').notNull(),
  ultimoCosto: importe('ultimo_costo'),
  orden: integer('orden').notNull(),
  archivadoEn: ts('archivado_en'),
  txId: xid8('tx_id'),
});

export const existencias = pgTable('existencias', {
  clasificacionId: uuid('clasificacion_id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  cantidad: cantidad('cantidad').notNull(),
  txId: xid8('tx_id'),
});

export const clientes = pgTable('clientes', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
  telefono: text('telefono'),
  ubicacion: text('ubicacion'),
  plazoDias: integer('plazo_dias'),
  saldoAFavor: importe('saldo_a_favor').notNull(),
  creadoEn: ts('creado_en').notNull(),
  archivadoEn: ts('archivado_en'),
  requiereRevision: boolean('requiere_revision').notNull(),
  txId: xid8('tx_id'),
});

export const proveedores = pgTable('proveedores', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  nombre: text('nombre').notNull(),
  telefono: text('telefono'),
  productos: text('productos').notNull(),
  archivadoEn: ts('archivado_en'),
  txId: xid8('tx_id'),
});

export const ventas = pgTable('ventas', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  folio: bigint('folio', { mode: 'number' }).notNull(),
  folioProvisional: text('folio_provisional'),
  clienteId: uuid('cliente_id'),
  clienteNombre: text('cliente_nombre'),
  formaPago: text('forma_pago').$type<'efectivo' | 'transferencia' | 'credito'>().notNull(),
  estado: text('estado').$type<'completada' | 'por_confirmar' | 'a_credito' | 'cancelada'>().notNull(),
  total: importe('total').notNull(),
  pagado: importe('pagado').notNull(),
  venceEl: date('vence_el', { mode: 'string' }),
  usuarioId: uuid('usuario_id').notNull(),
  usuarioNombre: text('usuario_nombre').notNull(),
  dispositivoId: uuid('dispositivo_id'),
  creadoEnDispositivo: ts('creado_en_dispositivo').notNull(),
  recibidoEnServidor: ts('recibido_en_servidor').notNull().defaultNow(),
  requiereRevision: boolean('requiere_revision').notNull(),
  motivoRevision: text('motivo_revision'),
  canceladaEn: ts('cancelada_en'),
  txId: xid8('tx_id'),
});

export const ventaRenglones = pgTable(
  'venta_renglones',
  {
    ventaId: uuid('venta_id').notNull(),
    linea: integer('linea').notNull(),
    negocioId: uuid('negocio_id').notNull(),
    clasificacionId: uuid('clasificacion_id').notNull(),
    productoId: uuid('producto_id').notNull(),
    productoNombre: text('producto_nombre').notNull(),
    clasificacionNombre: text('clasificacion_nombre').notNull(),
    unidadNombre: text('unidad_nombre').notNull(),
    unidadPlural: text('unidad_plural').notNull(),
    cantidad: cantidad('cantidad').notNull(),
    precio: importe('precio').notNull(),
    precioReferencia: importe('precio_referencia').notNull(),
    importe: importe('importe').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ventaId, t.linea] })],
);

export const pagos = pgTable('pagos', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  clienteId: uuid('cliente_id').notNull(),
  clienteNombre: text('cliente_nombre').notNull(),
  monto: importe('monto').notNull(),
  metodo: text('metodo').$type<'efectivo' | 'transferencia' | 'otro'>().notNull(),
  nota: text('nota'),
  excedente: importe('excedente').notNull(),
  usuarioId: uuid('usuario_id').notNull(),
  usuarioNombre: text('usuario_nombre').notNull(),
  creadoEnDispositivo: ts('creado_en_dispositivo').notNull(),
  requiereRevision: boolean('requiere_revision').notNull(),
  txId: xid8('tx_id'),
});

export const pagoAplicaciones = pgTable(
  'pago_aplicaciones',
  {
    pagoId: uuid('pago_id').notNull(),
    ventaId: uuid('venta_id').notNull(),
    negocioId: uuid('negocio_id').notNull(),
    monto: importe('monto').notNull(),
  },
  (t) => [primaryKey({ columns: [t.pagoId, t.ventaId] })],
);

export const compras = pgTable('compras', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  folio: bigint('folio', { mode: 'number' }).notNull(),
  folioProvisional: text('folio_provisional'),
  proveedorId: uuid('proveedor_id').notNull(),
  proveedorNombre: text('proveedor_nombre').notNull(),
  total: importe('total').notNull(),
  formaPago: text('forma_pago').$type<'contado' | 'credito'>().notNull(),
  venceEl: date('vence_el', { mode: 'string' }),
  usuarioId: uuid('usuario_id').notNull(),
  usuarioNombre: text('usuario_nombre').notNull(),
  creadoEnDispositivo: ts('creado_en_dispositivo').notNull(),
  txId: xid8('tx_id'),
});

export const compraRenglones = pgTable(
  'compra_renglones',
  {
    compraId: uuid('compra_id').notNull(),
    linea: integer('linea').notNull(),
    negocioId: uuid('negocio_id').notNull(),
    clasificacionId: uuid('clasificacion_id').notNull(),
    productoId: uuid('producto_id').notNull(),
    productoNombre: text('producto_nombre').notNull(),
    clasificacionNombre: text('clasificacion_nombre').notNull(),
    unidadNombre: text('unidad_nombre').notNull(),
    unidadPlural: text('unidad_plural').notNull(),
    cantidad: cantidad('cantidad').notNull(),
    costo: importe('costo').notNull(),
    importe: importe('importe').notNull(),
  },
  (t) => [primaryKey({ columns: [t.compraId, t.linea] })],
);

export const movimientosInventario = pgTable('movimientos_inventario', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  clasificacionId: uuid('clasificacion_id').notNull(),
  productoId: uuid('producto_id').notNull(),
  delta: cantidad('delta').notNull(),
  tipo: text('tipo').$type<'inicial' | 'compra' | 'venta' | 'merma' | 'ajuste' | 'cancelacion'>().notNull(),
  referencia: text('referencia'),
  motivo: text('motivo'),
  usuarioId: uuid('usuario_id'),
  usuarioNombre: text('usuario_nombre').notNull(),
  creadoEn: ts('creado_en').notNull(),
  txId: xid8('tx_id'),
});

export const movimientosDinero = pgTable('movimientos_dinero', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  tipo: text('tipo').$type<'ingreso' | 'egreso'>().notNull(),
  categoria: text('categoria').notNull(),
  concepto: text('concepto').notNull(),
  monto: importe('monto').notNull(),
  metodo: text('metodo').$type<'efectivo' | 'transferencia' | 'otro'>().notNull(),
  proveedorId: uuid('proveedor_id'),
  usuarioId: uuid('usuario_id'),
  usuarioNombre: text('usuario_nombre').notNull(),
  creadoEn: ts('creado_en').notNull(),
  txId: xid8('tx_id'),
});

export const operacionesSync = pgTable(
  'operaciones_sync',
  {
    negocioId: uuid('negocio_id').notNull(),
    operacionId: uuid('operacion_id').notNull(),
    tipo: text('tipo').notNull(),
    hash: text('hash').notNull(),
    datos: jsonb('datos').notNull(),
    estado: text('estado').$type<'aplicada' | 'en_revision' | 'rechazada'>().notNull(),
    aplicada: boolean('aplicada').notNull(),
    motivo: text('motivo'),
    resultado: jsonb('resultado'),
    resumen: text('resumen').notNull(),
    usuarioId: uuid('usuario_id'),
    dispositivoId: uuid('dispositivo_id'),
    creadoEnDispositivo: ts('creado_en_dispositivo').notNull(),
    recibidoEn: ts('recibido_en').notNull().defaultNow(),
    resolucion: text('resolucion').$type<'aprobada' | 'reaplicada' | 'descartada'>(),
    notaResolucion: text('nota_resolucion'),
    resueltaPor: uuid('resuelta_por'),
    resueltaEn: ts('resuelta_en'),
  },
  (t) => [primaryKey({ columns: [t.negocioId, t.operacionId] })],
);

export const auditoria = pgTable('auditoria', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  fecha: ts('fecha').notNull().defaultNow(),
  usuarioId: uuid('usuario_id'),
  usuarioNombre: text('usuario_nombre').notNull(),
  categoria: text('categoria').notNull(),
  descripcion: text('descripcion').notNull(),
  tabla: text('tabla'),
  registroId: uuid('registro_id'),
  valoresAnteriores: jsonb('valores_anteriores'),
  valoresNuevos: jsonb('valores_nuevos'),
});

export const alertasInventario = pgTable('alertas_inventario', {
  id: uuid('id').primaryKey(),
  negocioId: uuid('negocio_id').notNull(),
  clasificacionId: uuid('clasificacion_id').notNull(),
  existencia: cantidad('existencia').notNull(),
  sumaMovimientos: cantidad('suma_movimientos').notNull(),
  detectadaEn: ts('detectada_en').notNull(),
  resolucion: text('resolucion').$type<'corregida' | 'coincide'>(),
  resueltaPor: uuid('resuelta_por'),
  resueltaEn: ts('resuelta_en'),
});
