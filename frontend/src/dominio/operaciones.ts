/**
 * Operaciones permitidas sin conexión (decisiones técnicas §4.5): ventas, pagos de clientes,
 * mermas, compras, alta de clientes e ingresos/egresos simples.
 *
 * Cada una se guarda en una sola transacción de Dexie junto con su operación pendiente
 * (propuesta §7.1). Nunca depende de la red: la sincronización la envía después.
 */
import Decimal from 'decimal.js';
import { exigirOperable, tienePermiso } from '../auth/sesion';
import type { DatosMerma, DatosOperacion, TipoOperacion } from '@micentralmx/shared/api';
import type {
  Cliente,
  Compra,
  FormaPago,
  MetodoPago,
  MovimientoDinero,
  CategoriaDinero,
  Pago,
  RenglonCompra,
  RenglonVenta,
  Venta,
} from '@micentralmx/shared/entidades';
import { db, type OperacionLocal, type SesionLocal } from '../db/db';
import { aCantidad, aImporte, D, formatoMXN, sumar } from '../lib/dinero';
import { ahoraIso } from '../lib/fechas';
import { hashOperacion, nuevoId } from '../lib/ids';
import { avisarOperacionNueva } from '../sync/eventos';
import { catalogo, clientesVista, ordenCobro, existenciasEfectivas } from './consultas';
import { conAlmacenamiento, ErrorValidacion } from './errores';
import { cantidadConUnidad, CATEGORIAS_DINERO, folioCompra, folioVenta } from './formato';
import { reservarFolio } from './folios';

async function nuevaOperacion<T extends TipoOperacion>(
  tipo: T,
  datos: DatosOperacion[T],
  sesion: SesionLocal,
  resumen: string,
  entidadId: string,
): Promise<OperacionLocal<T>> {
  return {
    operacionId: nuevoId(),
    tipo,
    datos,
    hash: await hashOperacion(tipo, datos),
    estado: 'pendiente',
    usuarioId: sesion.usuario.id,
    creadoEnDispositivo: ahoraIso(),
    intentos: 0,
    motivo: null,
    respondidaEn: null,
    resumen,
    entidadId,
  };
}

function exigirPermiso(sesion: SesionLocal, permiso: Parameters<typeof tienePermiso>[1], accion: string) {
  if (!tienePermiso(sesion.usuario, permiso)) throw new ErrorValidacion(`Tu rol no permite ${accion}.`);
}

function validarCantidad(cantidad: string, permiteDecimales: boolean, campo: string) {
  const c = D(cantidad);
  if (!c.isFinite() || c.lte(0)) throw new ErrorValidacion('Escribe una cantidad mayor que cero.', campo);
  if (!permiteDecimales && !c.isInteger()) throw new ErrorValidacion('Esta unidad solo acepta cantidades enteras.', campo);
  if (c.decimalPlaces() > 3) throw new ErrorValidacion('Usa máximo 3 decimales.', campo);
}

// ── Ventas ───────────────────────────────────────────────────────────────────

export interface EntradaRenglon {
  clasificacionId: string;
  cantidad: string;
  precio: string;
}

export interface EntradaVenta {
  renglones: EntradaRenglon[];
  clienteId: string | null;
  formaPago: FormaPago;
  venceEl: string | null;
  /** Conexión al momento de confirmar: define la regla de stock (decisiones técnicas §2.2). */
  enLinea: boolean;
  /** Obligatorio para vender sin existencia en línea con permiso. */
  motivoSinExistencia: string | null;
}

export interface FaltanteExistencia {
  clasificacionId: string;
  descripcion: string;
  disponible: Decimal;
  pedido: Decimal;
}

/** Renglones que piden más de lo que hay (sumando renglones de la misma clasificación). */
export async function faltantes(renglones: EntradaRenglon[]): Promise<FaltanteExistencia[]> {
  const [existencias, productos] = await Promise.all([existenciasEfectivas(), catalogo(true)]);
  const pedido = new Map<string, Decimal>();
  for (const r of renglones) pedido.set(r.clasificacionId, (pedido.get(r.clasificacionId) ?? D(0)).plus(D(r.cantidad || 0)));
  const resultado: FaltanteExistencia[] = [];
  for (const [clasificacionId, cant] of pedido) {
    const disponible = existencias.get(clasificacionId) ?? D(0);
    if (cant.gt(disponible)) {
      const p = productos.find((x) => x.clasificaciones.some((c) => c.clasificacion.id === clasificacionId));
      const c = p?.clasificaciones.find((x) => x.clasificacion.id === clasificacionId);
      resultado.push({
        clasificacionId,
        descripcion: p && c ? `${cantidadConUnidad(disponible.toString(), p.unidad)} de ${c.clasificacion.nombre}` : 'existencia',
        disponible,
        pedido: cant,
      });
    }
  }
  return resultado;
}

export async function registrarVenta(entrada: EntradaVenta): Promise<Venta> {
  const { sesion, dispositivo } = await exigirOperable();
  exigirPermiso(sesion, 'ventas.crear', 'registrar ventas');
  if (entrada.renglones.length === 0) throw new ErrorValidacion('Agrega al menos un producto.', 'producto');
  if (entrada.formaPago === 'credito') {
    if (!entrada.clienteId) throw new ErrorValidacion('Elige el cliente para vender a crédito.', 'cliente');
    if (!entrada.venceEl) throw new ErrorValidacion('Indica la fecha de vencimiento del crédito.', 'vence');
  }

  const productos = await catalogo(true);
  const renglones: RenglonVenta[] = entrada.renglones.map((r, i) => {
    const p = productos.find((x) => x.clasificaciones.some((c) => c.clasificacion.id === r.clasificacionId));
    const c = p?.clasificaciones.find((x) => x.clasificacion.id === r.clasificacionId);
    if (!p || !c) throw new ErrorValidacion('Elige un producto y su clasificación.', `renglon-${i}`);
    validarCantidad(r.cantidad, p.unidad.permiteDecimales, `cantidad-${i}`);
    const precio = D(r.precio);
    if (!precio.isFinite() || precio.lt(0)) throw new ErrorValidacion('Escribe un precio válido.', `precio-${i}`);
    if (!precio.eq(c.clasificacion.precio)) exigirPermiso(sesion, 'ventas.modificar_precio', 'cambiar el precio en una venta');
    return {
      clasificacionId: c.clasificacion.id,
      productoId: p.producto.id,
      productoNombre: p.producto.nombre,
      clasificacionNombre: c.clasificacion.nombre,
      unidadNombre: p.unidad.nombre,
      unidadPlural: p.unidad.plural,
      cantidad: aCantidad(r.cantidad),
      precio: aImporte(precio),
      precioReferencia: aImporte(c.clasificacion.precio),
      importe: aImporte(precio.times(r.cantidad)),
    };
  });

  // Regla de stock: en línea se bloquea salvo permiso con motivo; sin conexión solo se advierte
  // y el servidor marca revisión si la existencia queda negativa.
  let requiereRevision = false;
  let motivoRevision: string | null = null;
  const faltan = await faltantes(entrada.renglones);
  if (faltan.length > 0 && entrada.enLinea) {
    if (!tienePermiso(sesion.usuario, 'ventas.vender_sin_existencia')) {
      throw new ErrorValidacion(`Solo hay ${faltan[0].descripcion}.`, 'existencia');
    }
    if (!entrada.motivoSinExistencia?.trim()) {
      throw new ErrorValidacion('Indica el motivo para vender sin existencia suficiente.', 'motivo');
    }
    requiereRevision = true;
    motivoRevision = `Venta sin existencia: ${entrada.motivoSinExistencia.trim()}`;
  }

  let clienteNombre: string | null = null;
  if (entrada.clienteId) {
    const cliente = await db.clientes.get(entrada.clienteId);
    if (!cliente) throw new ErrorValidacion('El cliente no existe en este dispositivo.', 'cliente');
    clienteNombre = cliente.nombre;
  }

  return conAlmacenamiento(async () => {
    const folio = await reservarFolio('venta');
    const total = sumar(renglones.map((r) => r.importe));
    const venta: Venta = {
      id: nuevoId(),
      ...folio,
      clienteId: entrada.clienteId,
      clienteNombre,
      formaPago: entrada.formaPago,
      estado: entrada.formaPago === 'credito' ? 'a_credito' : entrada.formaPago === 'transferencia' ? 'por_confirmar' : 'completada',
      renglones,
      total: aImporte(total),
      pagado: '0.00',
      venceEl: entrada.formaPago === 'credito' ? entrada.venceEl : null,
      usuarioId: sesion.usuario.id,
      usuarioNombre: sesion.usuario.nombre,
      dispositivoId: dispositivo.id,
      creadoEnDispositivo: ahoraIso(),
      requiereRevision,
      motivoRevision,
      canceladaEn: null,
    };
    const op = await nuevaOperacion('venta.crear', venta, sesion, `Venta ${folioVenta(venta)} · ${formatoMXN(total)}`, venta.id);
    await db.transaction('rw', db.ventas, db.movimientosInventario, db.operaciones, async () => {
      await db.ventas.add({ ...venta, operacionId: op.operacionId });
      await db.movimientosInventario.bulkAdd(
        renglones.map((r) => ({
          id: nuevoId(),
          clasificacionId: r.clasificacionId,
          productoId: r.productoId,
          delta: D(r.cantidad).neg().toString(),
          tipo: 'venta' as const,
          referencia: `Venta ${folioVenta(venta)}`,
          motivo: null,
          usuarioNombre: sesion.usuario.nombre,
          creadoEn: venta.creadoEnDispositivo,
          operacionId: op.operacionId,
        })),
      );
      await db.operaciones.add(op);
    });
    avisarOperacionNueva();
    return venta;
  });
}

// ── Pagos de clientes ───────────────────────────────────────────────────────

export interface EntradaPago {
  clienteId: string;
  monto: string;
  metodo: MetodoPago;
  nota: string | null;
  /** Desde una deuda: se aplica solo a esa venta. Sin ella, a la deuda que vence antes. */
  ventaId: string | null;
}

/** Reparte un pago entre las deudas abiertas del cliente. */
export async function sugerirAplicaciones(clienteId: string, monto: string, ventaId: string | null) {
  const cliente = (await clientesVista()).find((c) => c.cliente.id === clienteId);
  const deudas = ordenCobro(cliente?.deudasAbiertas ?? []).filter((d) => !ventaId || d.venta.id === ventaId);
  let restante = D(monto || 0);
  const aplicaciones: Pago['aplicaciones'] = [];
  for (const d of deudas) {
    if (restante.lte(0)) break;
    const aplicar = Decimal.min(restante, d.saldo);
    aplicaciones.push({ ventaId: d.venta.id, monto: aImporte(aplicar) });
    restante = restante.minus(aplicar);
  }
  return { aplicaciones, excedente: aImporte(Decimal.max(restante, 0)), deudas };
}

export async function registrarPago(entrada: EntradaPago): Promise<Pago> {
  const { sesion } = await exigirOperable();
  exigirPermiso(sesion, 'pagos.registrar', 'registrar pagos');
  const monto = D(entrada.monto || 0);
  if (!monto.isFinite() || monto.lte(0)) throw new ErrorValidacion('Escribe la cantidad recibida.', 'monto');
  if (monto.decimalPlaces() > 2) throw new ErrorValidacion('Usa máximo 2 decimales.', 'monto');
  const cliente = await db.clientes.get(entrada.clienteId);
  if (!cliente) throw new ErrorValidacion('Elige el cliente que paga.', 'cliente');

  const { aplicaciones, excedente } = await sugerirAplicaciones(entrada.clienteId, monto.toString(), entrada.ventaId);
  const pago: Pago = {
    id: nuevoId(),
    clienteId: cliente.id,
    clienteNombre: cliente.nombre,
    monto: aImporte(monto),
    metodo: entrada.metodo,
    nota: entrada.nota?.trim() || null,
    aplicaciones,
    excedente,
    usuarioId: sesion.usuario.id,
    usuarioNombre: sesion.usuario.nombre,
    creadoEnDispositivo: ahoraIso(),
    // El excedente queda como saldo a favor y siempre se revisa (decisiones técnicas §4.4).
    requiereRevision: D(excedente).gt(0),
  };
  return conAlmacenamiento(async () => {
    const op = await nuevaOperacion('pago.crear', pago, sesion, `Pago de ${cliente.nombre} · ${formatoMXN(monto)}`, pago.id);
    await db.transaction('rw', db.pagos, db.operaciones, async () => {
      await db.pagos.add({ ...pago, operacionId: op.operacionId });
      await db.operaciones.add(op);
    });
    avisarOperacionNueva();
    return pago;
  });
}

// ── Compras ─────────────────────────────────────────────────────────────────

export interface EntradaCompra {
  proveedorId: string;
  renglones: Array<{ clasificacionId: string; cantidad: string; costo: string }>;
  formaPago: 'contado' | 'credito';
  venceEl: string | null;
}

export async function registrarCompra(entrada: EntradaCompra): Promise<Compra> {
  const { sesion } = await exigirOperable();
  exigirPermiso(sesion, 'compras.crear', 'registrar compras');
  const proveedor = await db.proveedores.get(entrada.proveedorId);
  if (!proveedor) throw new ErrorValidacion('Elige el proveedor.', 'proveedor');
  if (entrada.renglones.length === 0) throw new ErrorValidacion('Agrega al menos un producto.', 'producto');
  if (entrada.formaPago === 'credito' && !entrada.venceEl) throw new ErrorValidacion('Indica la fecha de vencimiento.', 'vence');

  const productos = await catalogo(true);
  const renglones: RenglonCompra[] = entrada.renglones.map((r, i) => {
    const p = productos.find((x) => x.clasificaciones.some((c) => c.clasificacion.id === r.clasificacionId));
    const c = p?.clasificaciones.find((x) => x.clasificacion.id === r.clasificacionId);
    if (!p || !c) throw new ErrorValidacion('Elige un producto y su clasificación.', `renglon-${i}`);
    validarCantidad(r.cantidad, p.unidad.permiteDecimales, `cantidad-${i}`);
    const costo = D(r.costo || 0);
    if (!costo.isFinite() || costo.lte(0)) throw new ErrorValidacion('Escribe el precio de compra.', `costo-${i}`);
    return {
      clasificacionId: c.clasificacion.id,
      productoId: p.producto.id,
      productoNombre: p.producto.nombre,
      clasificacionNombre: c.clasificacion.nombre,
      unidadNombre: p.unidad.nombre,
      unidadPlural: p.unidad.plural,
      cantidad: aCantidad(r.cantidad),
      costo: aImporte(costo),
      importe: aImporte(costo.times(r.cantidad)),
    };
  });

  return conAlmacenamiento(async () => {
    const folio = await reservarFolio('compra');
    const total = sumar(renglones.map((r) => r.importe));
    const compra: Compra = {
      id: nuevoId(),
      ...folio,
      proveedorId: proveedor.id,
      proveedorNombre: proveedor.nombre,
      renglones,
      total: aImporte(total),
      formaPago: entrada.formaPago,
      venceEl: entrada.formaPago === 'credito' ? entrada.venceEl : null,
      usuarioId: sesion.usuario.id,
      usuarioNombre: sesion.usuario.nombre,
      creadoEnDispositivo: ahoraIso(),
    };
    const op = await nuevaOperacion('compra.crear', compra, sesion, `Compra ${folioCompra(compra)} · ${formatoMXN(total)}`, compra.id);
    await db.transaction('rw', db.compras, db.movimientosInventario, db.operaciones, async () => {
      await db.compras.add({ ...compra, operacionId: op.operacionId });
      await db.movimientosInventario.bulkAdd(
        renglones.map((r) => ({
          id: nuevoId(),
          clasificacionId: r.clasificacionId,
          productoId: r.productoId,
          delta: r.cantidad,
          tipo: 'compra' as const,
          referencia: `Compra ${folioCompra(compra)}`,
          motivo: null,
          usuarioNombre: sesion.usuario.nombre,
          creadoEn: compra.creadoEnDispositivo,
          operacionId: op.operacionId,
        })),
      );
      await db.operaciones.add(op);
    });
    avisarOperacionNueva();
    return compra;
  });
}

// ── Mermas ──────────────────────────────────────────────────────────────────

export async function registrarMerma(entrada: Omit<DatosMerma, 'id' | 'productoId'>): Promise<DatosMerma> {
  const { sesion } = await exigirOperable();
  exigirPermiso(sesion, 'inventario.merma', 'registrar mermas');
  const productos = await catalogo(true);
  const p = productos.find((x) => x.clasificaciones.some((c) => c.clasificacion.id === entrada.clasificacionId));
  const c = p?.clasificaciones.find((x) => x.clasificacion.id === entrada.clasificacionId);
  if (!p || !c) throw new ErrorValidacion('Elige el producto y su clasificación.', 'producto');
  validarCantidad(entrada.cantidad, p.unidad.permiteDecimales, 'cantidad');
  if (!entrada.motivo) throw new ErrorValidacion('Elige el motivo de la merma.', 'motivo');

  const merma: DatosMerma = {
    id: nuevoId(),
    clasificacionId: c.clasificacion.id,
    productoId: p.producto.id,
    cantidad: aCantidad(entrada.cantidad),
    motivo: entrada.motivo,
    nota: entrada.nota?.trim() || null,
  };
  return conAlmacenamiento(async () => {
    const op = await nuevaOperacion(
      'merma.crear',
      merma,
      sesion,
      `Merma · ${p.producto.nombre} ${c.clasificacion.nombre}, ${cantidadConUnidad(merma.cantidad, p.unidad)}`,
      merma.id,
    );
    await db.transaction('rw', db.movimientosInventario, db.operaciones, async () => {
      await db.movimientosInventario.add({
        id: merma.id,
        clasificacionId: merma.clasificacionId,
        productoId: merma.productoId,
        delta: D(merma.cantidad).neg().toString(),
        tipo: 'merma',
        referencia: null,
        motivo: merma.motivo,
        usuarioNombre: sesion.usuario.nombre,
        creadoEn: op.creadoEnDispositivo,
        operacionId: op.operacionId,
      });
      await db.operaciones.add(op);
    });
    avisarOperacionNueva();
    return merma;
  });
}

// ── Clientes ────────────────────────────────────────────────────────────────

export interface EntradaCliente {
  nombre: string;
  telefono: string | null;
  ubicacion: string | null;
  plazoDias: number | null;
}

const soloDigitos = (t: string | null) => (t ?? '').replace(/\D/g, '');

/** Clientes con el mismo teléfono en este dispositivo (decisiones técnicas §4.4). */
export async function clientesConTelefono(telefono: string | null) {
  const digitos = soloDigitos(telefono);
  if (digitos.length < 8) return [];
  return (await db.clientes.toArray()).filter((c) => !c.archivadoEn && soloDigitos(c.telefono) === digitos);
}

export async function crearCliente(entrada: EntradaCliente): Promise<Cliente> {
  const { sesion } = await exigirOperable();
  exigirPermiso(sesion, 'clientes.crear', 'agregar clientes');
  const nombre = entrada.nombre.trim();
  if (nombre.length < 2) throw new ErrorValidacion('Escribe el nombre del cliente.', 'nombre');
  const telefono = entrada.telefono?.trim() || null;
  if (telefono && soloDigitos(telefono).length < 10) throw new ErrorValidacion('El teléfono debe tener 10 dígitos.', 'telefono');
  if (entrada.plazoDias != null && (entrada.plazoDias < 1 || entrada.plazoDias > 120)) {
    throw new ErrorValidacion('El plazo debe estar entre 1 y 120 días.', 'plazo');
  }
  const cliente: Cliente = {
    id: nuevoId(),
    nombre,
    telefono,
    ubicacion: entrada.ubicacion?.trim() || null,
    plazoDias: entrada.plazoDias,
    saldoAFavor: '0.00',
    creadoEn: ahoraIso(),
    archivadoEn: null,
    requiereRevision: false,
  };
  return conAlmacenamiento(async () => {
    const op = await nuevaOperacion('cliente.crear', cliente, sesion, `Cliente nuevo · ${nombre}`, cliente.id);
    await db.transaction('rw', db.clientes, db.operaciones, async () => {
      await db.clientes.add({ ...cliente, operacionId: op.operacionId });
      await db.operaciones.add(op);
    });
    avisarOperacionNueva();
    return cliente;
  });
}

// ── Ingresos y egresos simples ──────────────────────────────────────────────

export interface EntradaMovimientoDinero {
  categoria: CategoriaDinero;
  concepto: string;
  monto: string;
  metodo: MetodoPago;
  proveedorId: string | null;
}

export async function registrarMovimientoDinero(entrada: EntradaMovimientoDinero): Promise<MovimientoDinero> {
  const { sesion } = await exigirOperable();
  exigirPermiso(sesion, 'dinero.registrar', 'registrar ingresos y egresos');
  const monto = D(entrada.monto || 0);
  if (!monto.isFinite() || monto.lte(0)) throw new ErrorValidacion('Escribe el monto.', 'monto');
  const categoria = CATEGORIAS_DINERO[entrada.categoria];
  let concepto = entrada.concepto.trim();
  let proveedorId: string | null = null;
  if (entrada.categoria === 'pago_proveedor') {
    const proveedor = entrada.proveedorId ? await db.proveedores.get(entrada.proveedorId) : undefined;
    if (!proveedor) throw new ErrorValidacion('Elige el proveedor.', 'proveedor');
    proveedorId = proveedor.id;
    concepto = `Pago a proveedor · ${proveedor.nombre}`;
  }
  if (!concepto) concepto = categoria.nombre;
  const mov: MovimientoDinero = {
    id: nuevoId(),
    tipo: categoria.tipo,
    categoria: entrada.categoria,
    concepto,
    monto: aImporte(monto),
    metodo: entrada.metodo,
    proveedorId,
    usuarioNombre: sesion.usuario.nombre,
    creadoEn: ahoraIso(),
  };
  return conAlmacenamiento(async () => {
    const signo = mov.tipo === 'ingreso' ? '+' : '−';
    const op = await nuevaOperacion('movimiento_dinero.crear', mov, sesion, `${concepto} · ${signo}${formatoMXN(monto)}`, mov.id);
    await db.transaction('rw', db.movimientosDinero, db.operaciones, async () => {
      await db.movimientosDinero.add({ ...mov, operacionId: op.operacionId });
      await db.operaciones.add(op);
    });
    avisarOperacionNueva();
    return mov;
  });
}
