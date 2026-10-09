import Dexie, { type EntityTable } from 'dexie';
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
} from '@micentralmx/shared/entidades';
import type { DatosOperacion, TipoFolio, TipoOperacion } from '@micentralmx/shared/api';

/** Registro creado en este dispositivo: guarda la operación que lo sincroniza. */
type Local<T> = T & { operacionId?: string | null };

export type VentaLocal = Local<Venta>;
export type PagoLocal = Local<Pago>;
export type CompraLocal = Local<Compra>;
export type MovimientoInventarioLocal = Local<MovimientoInventario>;
export type MovimientoDineroLocal = Local<MovimientoDinero>;
export type ClienteLocal = Local<Cliente>;

/** Estados de una operación en la cola local (propuesta §7.2). */
export type EstadoSync = 'pendiente' | 'enviando' | 'sincronizada' | 'en_revision' | 'rechazada';

export interface OperacionLocal<T extends TipoOperacion = TipoOperacion> {
  operacionId: string;
  tipo: T;
  datos: DatosOperacion[T];
  hash: string;
  estado: EstadoSync;
  usuarioId: string;
  creadoEnDispositivo: string;
  intentos: number;
  motivo: string | null;
  /** Momento en que el servidor respondió; decide si la operación ya está en el snapshot. */
  respondidaEn: string | null;
  /** Texto para la hoja de sincronización: "Venta #000129 · $1,700". */
  resumen: string;
  entidadId: string;
  /** El usuario ya vio que quedó en revisión o rechazada; deja de contarse en la insignia. */
  enteradoEn?: string | null;
}

export interface BloqueFolioLocal {
  id: string;
  tipo: TipoFolio;
  desde: number;
  hasta: number;
  /** Siguiente folio sin usar del bloque. */
  siguiente: number;
}

export interface SesionLocal {
  usuario: UsuarioSesion;
  negocio: Negocio;
  configuracion: ConfiguracionNegocio;
  iniciadaEn: string;
}

export interface DispositivoLocal {
  id: string;
  codigo: string;
  negocioId: string;
  /** Contador del folio provisional que se usa al agotar un bloque sin conexión. */
  provisionales: Record<TipoFolio, number>;
}

export interface Metadatos {
  sesion: SesionLocal;
  dispositivo: DispositivoLocal;
  /** Último contacto exitoso con el servidor: base de la ventana offline. */
  ultimoContacto: string;
  cursor: string;
  ultimoPullInicio: string;
  ultimoPullFin: string;
  desfaseRelojMs: number;
}
type ClaveMeta = keyof Metadatos;

interface FilaMeta {
  clave: ClaveMeta;
  valor: unknown;
}

export class BaseLocal extends Dexie {
  meta!: EntityTable<FilaMeta, 'clave'>;
  unidades!: EntityTable<Unidad, 'id'>;
  productos!: EntityTable<Producto, 'id'>;
  clasificaciones!: EntityTable<Clasificacion, 'id'>;
  existencias!: EntityTable<Existencia, 'clasificacionId'>;
  clientes!: EntityTable<ClienteLocal, 'id'>;
  proveedores!: EntityTable<Proveedor, 'id'>;
  ventas!: EntityTable<VentaLocal, 'id'>;
  pagos!: EntityTable<PagoLocal, 'id'>;
  compras!: EntityTable<CompraLocal, 'id'>;
  movimientosInventario!: EntityTable<MovimientoInventarioLocal, 'id'>;
  movimientosDinero!: EntityTable<MovimientoDineroLocal, 'id'>;
  operaciones!: EntityTable<OperacionLocal, 'operacionId'>;
  bloquesFolio!: EntityTable<BloqueFolioLocal, 'id'>;

  constructor(nombre = 'micentralmx') {
    super(nombre);
    // Las migraciones futuras agregan .version(n) y nunca borran la tabla `operaciones`
    // (decisiones técnicas §7: las migraciones de Dexie conservan la cola).
    this.version(1).stores({
      meta: '&clave',
      unidades: '&id',
      productos: '&id, nombre',
      clasificaciones: '&id, productoId',
      existencias: '&clasificacionId',
      clientes: '&id, nombre, telefono',
      proveedores: '&id, nombre',
      ventas: '&id, creadoEnDispositivo, clienteId, folio, operacionId',
      pagos: '&id, creadoEnDispositivo, clienteId, operacionId',
      compras: '&id, creadoEnDispositivo, proveedorId, operacionId',
      movimientosInventario: '&id, clasificacionId, productoId, creadoEn, operacionId',
      movimientosDinero: '&id, creadoEn, operacionId',
      operaciones: '&operacionId, estado, creadoEnDispositivo',
      bloquesFolio: '&id, tipo',
    });
  }

  async leerMeta<K extends ClaveMeta>(clave: K): Promise<Metadatos[K] | undefined> {
    const fila = await this.meta.get(clave);
    return fila?.valor as Metadatos[K] | undefined;
  }

  async guardarMeta<K extends ClaveMeta>(clave: K, valor: Metadatos[K]): Promise<void> {
    await this.meta.put({ clave, valor });
  }

  async borrarMeta(clave: ClaveMeta): Promise<void> {
    await this.meta.delete(clave);
  }

  /** Tablas con datos del negocio (se vacían si otro negocio inicia sesión en el dispositivo). */
  get tablasNegocio() {
    return [
      this.unidades,
      this.productos,
      this.clasificaciones,
      this.existencias,
      this.clientes,
      this.proveedores,
      this.ventas,
      this.pagos,
      this.compras,
      this.movimientosInventario,
      this.movimientosDinero,
      this.operaciones,
      this.bloquesFolio,
    ];
  }
}

export const db = new BaseLocal();
