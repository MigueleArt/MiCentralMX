/**
 * Contrato HTTP entre la PWA y la API (decisiones técnicas §4.2).
 * El sobre de sincronización usa snake_case como en el documento; las entidades, camelCase.
 */
import { z } from 'zod';
import type {
  Cliente,
  Clasificacion,
  Compra,
  ConfiguracionNegocio,
  Existencia,
  MovimientoDinero,
  MovimientoInventario,
  Negocio,
  Pago,
  Producto,
  Proveedor,
  Unidad,
  UsuarioSesion,
  Venta,
} from './entidades';

// ── Autenticación y dispositivo ──────────────────────────────────────────────

export interface RespuestaLogin {
  access_token: string;
  usuario: UsuarioSesion;
  negocio: Negocio;
  configuracion: ConfiguracionNegocio;
}

export type TipoFolio = 'venta' | 'compra';

export interface BloqueFolio {
  id: string;
  tipo: TipoFolio;
  desde: number;
  hasta: number;
}

export interface RespuestaRegistroDispositivo {
  dispositivo_id: string;
  /** Código corto visible: D1, D2… */
  codigo: string;
  bloques: BloqueFolio[];
}

// ── Operaciones offline ──────────────────────────────────────────────────────

export interface DatosMerma {
  id: string;
  clasificacionId: string;
  productoId: string;
  cantidad: string;
  motivo: string;
  nota: string | null;
}

export interface DatosOperacion {
  'venta.crear': Venta;
  'pago.crear': Pago;
  'compra.crear': Compra;
  'merma.crear': DatosMerma;
  'cliente.crear': Cliente;
  'movimiento_dinero.crear': MovimientoDinero;
}
export type TipoOperacion = keyof DatosOperacion;

export interface OperacionPush<T extends TipoOperacion = TipoOperacion> {
  operacion_id: string;
  tipo: T;
  usuario_id: string;
  creado_en_dispositivo: string;
  hash: string;
  datos: DatosOperacion[T];
}

export interface SolicitudPush {
  dispositivo_id: string;
  reloj_dispositivo: string;
  version_contrato: number;
  operaciones: OperacionPush[];
}

export const esquemaRespuestaPush = z.object({
  reloj_servidor: z.string(),
  resultados: z.array(
    z.object({
      operacion_id: z.string(),
      estado: z.enum(['aplicada', 'duplicada', 'en_revision', 'rechazada']),
      motivo: z.string().nullish(),
      resultado: z.object({ folio: z.number().nullish() }).partial().nullish(),
    }),
  ),
});
export type RespuestaPush = z.infer<typeof esquemaRespuestaPush>;
export type EstadoRespuestaOperacion = RespuestaPush['resultados'][number]['estado'];

// ── Bajada ───────────────────────────────────────────────────────────────────

export interface CambiosPull {
  unidades: Unidad[];
  productos: Producto[];
  clasificaciones: Clasificacion[];
  existencias: Existencia[];
  clientes: Cliente[];
  proveedores: Proveedor[];
  ventas: Venta[];
  pagos: Pago[];
  compras: Compra[];
  movimientosInventario: MovimientoInventario[];
  movimientosDinero: MovimientoDinero[];
}

const lista = z.array(z.record(z.string(), z.unknown())).default([]);
export const esquemaRespuestaPull = z.object({
  cursor: z.string(),
  hay_mas: z.boolean(),
  usuario: z.record(z.string(), z.unknown()).nullish(),
  configuracion: z.object({ ventanaOfflineHoras: z.number(), plazoCreditoDias: z.number() }).nullish(),
  cambios: z.object({
    unidades: lista,
    productos: lista,
    clasificaciones: lista,
    existencias: lista,
    clientes: lista,
    proveedores: lista,
    ventas: lista,
    pagos: lista,
    compras: lista,
    movimientosInventario: lista,
    movimientosDinero: lista,
  }),
});
export interface RespuestaPull {
  cursor: string;
  hay_mas: boolean;
  usuario?: UsuarioSesion | null;
  configuracion?: ConfiguracionNegocio | null;
  cambios: CambiosPull;
}

// ── Pantallas solo en línea (TanStack Query) ────────────────────────────────

export interface ResumenReportes {
  desde: string;
  hasta: string;
  ventas: { total: string; cantidad: number; aCredito: number };
  compras: { total: string; cantidad: number; proveedores: number };
  inventario: { productos: number; bajos: number };
  pagos: { ingresos: string; egresos: string };
  deudas: { porCobrar: string; vencido: string };
  mermas: { valor: string; cantidad: string; unidad: string };
}

export interface UsuarioNegocio {
  id: string;
  nombre: string;
  usuario: string;
  rolId: string;
  rolNombre: string;
  activo: boolean;
  ultimaActividad: string | null;
}

export interface RolNegocio {
  id: string;
  nombre: string;
  base: string | null;
  permisos: string[];
  editable: boolean;
}

export type CategoriaHistorial = 'ventas' | 'pagos' | 'inventario' | 'usuarios' | 'compras' | 'catalogo' | 'configuracion';

export interface EntradaHistorial {
  id: string;
  fecha: string;
  usuarioNombre: string;
  categoria: CategoriaHistorial;
  descripcion: string;
}

// ── Revisiones (operaciones sincronizadas que un usuario autorizado debe resolver) ──

export type AccionRevision = 'aprobar' | 'reaplicar' | 'descartar';

export interface OperacionEnRevision {
  operacionId: string;
  tipo: TipoOperacion;
  resumen: string;
  estado: 'en_revision' | 'rechazada';
  /** true: ya está registrada y solo falta aprobarla; false: no se aplicó (reaplicar o descartar). */
  aplicada: boolean;
  motivo: string | null;
  usuarioNombre: string | null;
  dispositivoCodigo: string | null;
  creadoEnDispositivo: string;
  recibidoEn: string;
  /** Registro afectado (venta, pago, cliente…) y cliente relacionado, para enlazar a su detalle. */
  entidadId: string | null;
  clienteId: string | null;
  resolucion: 'aprobada' | 'reaplicada' | 'descartada' | null;
  notaResolucion: string | null;
  resueltaPorNombre: string | null;
  resueltaEn: string | null;
}

/** Clasificación cuya existencia no coincide con la suma de su historial (conciliación nocturna). */
export interface AlertaInventario {
  id: string;
  clasificacionId: string;
  productoId: string;
  descripcion: string;
  unidadPlural: string;
  existencia: string;
  sumaMovimientos: string;
  detectadaEn: string;
}

export interface DatosProducto {
  nombre: string;
  unidadId: string;
  umbralBajo: string;
  clasificaciones: Array<{ id: string; nombre: string; precio: string; existenciaInicial?: string }>;
}

export interface SolicitudAjuste {
  clasificacionId: string;
  cantidadContada: string;
  motivo: string;
}
