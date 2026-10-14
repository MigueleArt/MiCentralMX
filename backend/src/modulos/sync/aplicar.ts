/**
 * Aplica una operación offline en el servidor (decisiones técnicas §4.2 y §4.4).
 *
 * Resultados:
 *  - aplicada: quedó registrada.
 *  - en_revision + aplicada: quedó registrada, pero un usuario autorizado debe revisarla
 *    (existencia negativa, excedente, reloj desfasado, usuario suspendido, cliente duplicado…).
 *  - en_revision sin aplicar: depende de algo que no existe en el servidor (cliente, venta, proveedor);
 *    se puede reaplicar desde Revisiones.
 *  - rechazada: no es válida (permisos, folio ajeno, datos inválidos).
 */
import type { Permiso } from '@micentralmx/shared/permisos';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuid } from 'uuid';
import type { z } from 'zod';
import type { Tx } from '../../db/pool';
import { clasificaciones, clientes, compraRenglones, compras, movimientosDinero, pagoAplicaciones, pagos, productos, proveedores, unidades, ventaRenglones, ventas } from '../../db/esquema';
import type { UsuarioActual } from '../../http/ruta';
import { registrarAuditoria } from '../../lib/auditoria';
import { aCantidad, aImporte, D, folioCompra, folioVenta, formatoMXN, sumar } from '../../lib/dinero';
import { moverExistencia } from '../../lib/inventario';
import { folioDelDispositivo, folioSuelto } from '../dispositivos';
import { CATEGORIAS, esquemaCliente, esquemaCompra, esquemaMerma, esquemaMovimientoDinero, esquemaPago, esquemaVenta } from './esquemas';

export interface Resultado {
  estado: 'aplicada' | 'en_revision' | 'rechazada';
  aplicada: boolean;
  motivo: string | null;
  resultado: { folio?: number } | null;
  resumen: string;
}

/** Operación inválida: se rechaza sin aplicar. */
export class Rechazo extends Error {}
/** Falta algo de lo que depende: queda en revisión sin aplicar. */
export class Dependencia extends Error {}

export interface ContextoAplicacion {
  autor: UsuarioActual;
  dispositivoId: string | null;
  creadoEnDispositivo: Date;
  /** Motivos de revisión generales del lote (reloj, usuario suspendido). */
  revisionGeneral: string[];
}

function exigirPermiso(autor: UsuarioActual, p: Permiso, accion: string) {
  if (!autor.permisos.includes(p)) throw new Rechazo(`El usuario no tiene permiso para ${accion}.`);
}

function parsear<T extends z.ZodType>(esquema: T, datos: unknown): z.infer<T> {
  const r = esquema.safeParse(datos);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new Rechazo(`Datos inválidos (${i.path.join('.') || 'operación'}: ${i.message}).`);
  }
  return r.data;
}

async function catalogoDe(tx: Tx, ids: string[]) {
  const filas = await tx
    .select({ c: clasificaciones, p: productos, u: unidades })
    .from(clasificaciones)
    .innerJoin(productos, eq(productos.id, clasificaciones.productoId))
    .innerJoin(unidades, eq(unidades.id, productos.unidadId))
    .where(inArray(clasificaciones.id, ids));
  return new Map(filas.map((f) => [f.c.id, f]));
}

function validarCantidad(cantidad: string, permiteDecimales: boolean) {
  const c = D(cantidad);
  if (c.lte(0)) throw new Rechazo('La cantidad debe ser mayor que cero.');
  if (!permiteDecimales && !c.isInteger()) throw new Rechazo('La unidad solo acepta cantidades enteras.');
  if (c.decimalPlaces() > 3) throw new Rechazo('La cantidad admite máximo 3 decimales.');
}

/** Folio definitivo del bloque del dispositivo, o uno nuevo si llegó provisional. */
async function resolverFolio(tx: Tx, autor: UsuarioActual, ctx: ContextoAplicacion, tipo: 'venta' | 'compra', folio: number | null) {
  if (folio == null) return { folio: await folioSuelto(tx, autor.negocioId, tipo), asignado: true };
  if (!ctx.dispositivoId || !(await folioDelDispositivo(tx, ctx.dispositivoId, tipo, folio))) {
    throw new Rechazo(`El folio ${folio} no pertenece a los bloques de este dispositivo.`);
  }
  return { folio, asignado: false };
}

const resultado = (resumen: string, revision: string[], extra: Partial<Resultado> = {}): Resultado => ({
  estado: revision.length ? 'en_revision' : 'aplicada',
  aplicada: true,
  motivo: revision.length ? revision.join(' ') : null,
  resultado: null,
  resumen,
  ...extra,
});

// ── Venta ────────────────────────────────────────────────────────────────────

async function aplicarVenta(tx: Tx, datos: unknown, ctx: ContextoAplicacion): Promise<Resultado> {
  const { autor } = ctx;
  exigirPermiso(autor, 'ventas.crear', 'vender');
  const v = parsear(esquemaVenta, datos);
  const revision = [...ctx.revisionGeneral];

  let clienteNombre: string | null = null;
  if (v.clienteId) {
    const [c] = await tx.select({ nombre: clientes.nombre }).from(clientes).where(eq(clientes.id, v.clienteId));
    if (!c) throw new Dependencia('El cliente de la venta no existe en el servidor.');
    clienteNombre = c.nombre;
  }
  if (v.formaPago === 'credito' && (!v.clienteId || !v.venceEl)) throw new Rechazo('Una venta a crédito necesita cliente y fecha de vencimiento.');

  const cat = await catalogoDe(tx, v.renglones.map((r) => r.clasificacionId));
  const renglones = v.renglones.map((r, linea) => {
    const f = cat.get(r.clasificacionId);
    if (!f) throw new Rechazo('Un producto de la venta no existe.');
    validarCantidad(r.cantidad, f.u.permiteDecimales);
    // El precio aplicado distinto al de referencia requiere permiso (decisiones técnicas §2.9).
    if (!D(r.precio).eq(r.precioReferencia)) exigirPermiso(autor, 'ventas.modificar_precio', 'cambiar el precio en una venta');
    return {
      linea,
      clasificacionId: f.c.id,
      productoId: f.p.id,
      productoNombre: f.p.nombre,
      clasificacionNombre: f.c.nombre,
      unidadNombre: f.u.nombre,
      unidadPlural: f.u.plural,
      cantidad: aCantidad(r.cantidad),
      precio: aImporte(r.precio),
      precioReferencia: aImporte(r.precioReferencia),
      importe: aImporte(D(r.precio).times(r.cantidad)),
    };
  });
  const total = sumar(renglones.map((r) => r.importe));
  const { folio, asignado } = await resolverFolio(tx, autor, ctx, 'venta', v.folio);
  if (v.motivoRevision) revision.push(v.motivoRevision);

  // Primero los movimientos: si la existencia queda negativa, la venta se aplica y se marca (decisiones técnicas §2.2).
  for (const r of renglones) {
    const queda = await moverExistencia(tx, {
      negocioId: autor.negocioId,
      clasificacionId: r.clasificacionId,
      productoId: r.productoId,
      delta: D(r.cantidad).neg().toString(),
      tipo: 'venta',
      referencia: `Venta ${folioVenta(folio)}`,
      usuarioId: autor.id,
      usuarioNombre: autor.nombre,
      creadoEn: ctx.creadoEnDispositivo,
    });
    if (queda.lt(0) && !revision.includes('La existencia quedó negativa.')) revision.push('La existencia quedó negativa.');
  }
  await tx.insert(ventas).values({
    id: v.id,
    negocioId: autor.negocioId,
    folio,
    folioProvisional: v.folioProvisional,
    clienteId: v.clienteId,
    clienteNombre,
    formaPago: v.formaPago,
    estado: v.formaPago === 'credito' ? 'a_credito' : v.formaPago === 'transferencia' ? 'por_confirmar' : 'completada',
    total: aImporte(total),
    pagado: '0',
    venceEl: v.formaPago === 'credito' ? v.venceEl : null,
    usuarioId: autor.id,
    usuarioNombre: autor.nombre,
    dispositivoId: ctx.dispositivoId,
    creadoEnDispositivo: ctx.creadoEnDispositivo,
    requiereRevision: revision.length > 0,
    motivoRevision: revision.join(' ') || null,
  });
  await tx.insert(ventaRenglones).values(renglones.map((r) => ({ ...r, ventaId: v.id, negocioId: autor.negocioId })));
  const resumen = `Venta ${folioVenta(folio)} · ${formatoMXN(total)}`;
  await registrarAuditoria(tx, autor, 'ventas', `${autor.nombre} registró la venta ${folioVenta(folio)} por ${formatoMXN(total)}`, {
    tabla: 'ventas',
    registroId: v.id,
    fecha: ctx.creadoEnDispositivo,
  });
  return resultado(resumen, revision, { resultado: asignado ? { folio } : null });
}

// ── Pago ─────────────────────────────────────────────────────────────────────

async function aplicarPago(tx: Tx, datos: unknown, ctx: ContextoAplicacion): Promise<Resultado> {
  const { autor } = ctx;
  exigirPermiso(autor, 'pagos.registrar', 'registrar pagos');
  const p = parsear(esquemaPago, datos);
  const revision = [...ctx.revisionGeneral];
  const monto = D(p.monto);
  if (monto.lte(0)) throw new Rechazo('El pago debe ser mayor que cero.');
  const [cliente] = await tx.select().from(clientes).where(eq(clientes.id, p.clienteId));
  if (!cliente) throw new Dependencia('El cliente del pago no existe en el servidor.');

  const ids = p.aplicaciones.map((a) => a.ventaId);
  // Bloquea las ventas para que dos pagos simultáneos no rebasen el saldo.
  const deudas = ids.length
    ? await tx.select().from(ventas).where(and(inArray(ventas.id, ids), eq(ventas.clienteId, p.clienteId))).for('update')
    : [];
  if (deudas.length < ids.length) throw new Dependencia('Una de las ventas del pago no existe en el servidor.');

  const aplicadas: Array<{ ventaId: string; monto: string }> = [];
  let restante = monto;
  for (const a of p.aplicaciones) {
    const venta = deudas.find((d) => d.id === a.ventaId)!;
    if (restante.lte(0)) break;
    const saldo = venta.formaPago === 'credito' && venta.estado !== 'cancelada' ? D(venta.total).minus(venta.pagado) : D(0);
    const aplicar = Decimal_min(Decimal_min(D(a.monto), saldo), restante);
    if (aplicar.lte(0)) continue;
    const pagado = D(venta.pagado).plus(aplicar);
    await tx
      .update(ventas)
      .set({ pagado: aImporte(pagado), estado: pagado.gte(venta.total) ? 'completada' : 'a_credito' })
      .where(eq(ventas.id, venta.id));
    aplicadas.push({ ventaId: venta.id, monto: aImporte(aplicar) });
    restante = restante.minus(aplicar);
  }
  if (restante.gt(0)) {
    revision.push(`Excedente de ${formatoMXN(restante)} como saldo a favor.`);
    await tx.update(clientes).set({ saldoAFavor: aImporte(D(cliente.saldoAFavor).plus(restante)) }).where(eq(clientes.id, cliente.id));
  }
  await tx.insert(pagos).values({
    id: p.id,
    negocioId: autor.negocioId,
    clienteId: cliente.id,
    clienteNombre: cliente.nombre,
    monto: aImporte(monto),
    metodo: p.metodo,
    nota: p.nota?.trim() || null,
    excedente: aImporte(restante),
    usuarioId: autor.id,
    usuarioNombre: autor.nombre,
    creadoEnDispositivo: ctx.creadoEnDispositivo,
    requiereRevision: revision.length > 0,
  });
  if (aplicadas.length) await tx.insert(pagoAplicaciones).values(aplicadas.map((a) => ({ ...a, pagoId: p.id, negocioId: autor.negocioId })));
  await registrarAuditoria(tx, autor, 'pagos', `${autor.nombre} registró un pago de ${formatoMXN(monto)} de ${cliente.nombre}`, {
    tabla: 'pagos',
    registroId: p.id,
    fecha: ctx.creadoEnDispositivo,
  });
  return resultado(`Pago de ${cliente.nombre} · ${formatoMXN(monto)}`, revision);
}

const Decimal_min = (a: ReturnType<typeof D>, b: ReturnType<typeof D>) => (a.lt(b) ? a : b);

// ── Compra ───────────────────────────────────────────────────────────────────

async function aplicarCompra(tx: Tx, datos: unknown, ctx: ContextoAplicacion): Promise<Resultado> {
  const { autor } = ctx;
  exigirPermiso(autor, 'compras.crear', 'registrar compras');
  const c = parsear(esquemaCompra, datos);
  const revision = [...ctx.revisionGeneral];
  const [prov] = await tx.select({ nombre: proveedores.nombre }).from(proveedores).where(eq(proveedores.id, c.proveedorId));
  if (!prov) throw new Dependencia('El proveedor de la compra no existe en el servidor.');
  if (c.formaPago === 'credito' && !c.venceEl) throw new Rechazo('Una compra a crédito necesita fecha de vencimiento.');

  const cat = await catalogoDe(tx, c.renglones.map((r) => r.clasificacionId));
  const renglones = c.renglones.map((r, linea) => {
    const f = cat.get(r.clasificacionId);
    if (!f) throw new Rechazo('Un producto de la compra no existe.');
    validarCantidad(r.cantidad, f.u.permiteDecimales);
    if (D(r.costo).lte(0)) throw new Rechazo('El precio de compra debe ser mayor que cero.');
    return {
      linea,
      clasificacionId: f.c.id,
      productoId: f.p.id,
      productoNombre: f.p.nombre,
      clasificacionNombre: f.c.nombre,
      unidadNombre: f.u.nombre,
      unidadPlural: f.u.plural,
      cantidad: aCantidad(r.cantidad),
      costo: aImporte(r.costo),
      importe: aImporte(D(r.costo).times(r.cantidad)),
    };
  });
  const total = sumar(renglones.map((r) => r.importe));
  const { folio, asignado } = await resolverFolio(tx, autor, ctx, 'compra', c.folio);
  await tx.insert(compras).values({
    id: c.id,
    negocioId: autor.negocioId,
    folio,
    folioProvisional: c.folioProvisional,
    proveedorId: c.proveedorId,
    proveedorNombre: prov.nombre,
    total: aImporte(total),
    formaPago: c.formaPago,
    venceEl: c.formaPago === 'credito' ? c.venceEl : null,
    usuarioId: autor.id,
    usuarioNombre: autor.nombre,
    creadoEnDispositivo: ctx.creadoEnDispositivo,
  });
  await tx.insert(compraRenglones).values(renglones.map((r) => ({ ...r, compraId: c.id, negocioId: autor.negocioId })));
  for (const r of renglones) {
    await moverExistencia(tx, {
      negocioId: autor.negocioId,
      clasificacionId: r.clasificacionId,
      productoId: r.productoId,
      delta: r.cantidad,
      tipo: 'compra',
      referencia: `Compra ${folioCompra(folio)}`,
      usuarioId: autor.id,
      usuarioNombre: autor.nombre,
      creadoEn: ctx.creadoEnDispositivo,
    });
    // Último costo: precio de referencia de compra y valor de mermas (decisiones técnicas §3).
    await tx.update(clasificaciones).set({ ultimoCosto: r.costo }).where(eq(clasificaciones.id, r.clasificacionId));
  }
  await registrarAuditoria(tx, autor, 'compras', `${autor.nombre} registró la compra ${folioCompra(folio)} de ${prov.nombre}`, {
    tabla: 'compras',
    registroId: c.id,
    fecha: ctx.creadoEnDispositivo,
  });
  return resultado(`Compra ${folioCompra(folio)} · ${formatoMXN(total)}`, revision, { resultado: asignado ? { folio } : null });
}

// ── Merma ────────────────────────────────────────────────────────────────────

async function aplicarMerma(tx: Tx, datos: unknown, ctx: ContextoAplicacion): Promise<Resultado> {
  const { autor } = ctx;
  exigirPermiso(autor, 'inventario.merma', 'registrar mermas');
  const m = parsear(esquemaMerma, datos);
  const revision = [...ctx.revisionGeneral];
  const f = (await catalogoDe(tx, [m.clasificacionId])).get(m.clasificacionId);
  if (!f) throw new Rechazo('El producto de la merma no existe.');
  validarCantidad(m.cantidad, f.u.permiteDecimales);
  const queda = await moverExistencia(tx, {
    id: m.id,
    negocioId: autor.negocioId,
    clasificacionId: f.c.id,
    productoId: f.p.id,
    delta: D(m.cantidad).neg().toString(),
    tipo: 'merma',
    motivo: m.motivo,
    usuarioId: autor.id,
    usuarioNombre: autor.nombre,
    creadoEn: ctx.creadoEnDispositivo,
  });
  if (queda.lt(0)) revision.push('La existencia quedó negativa.');
  const cantidad = `${aCantidad(m.cantidad)} ${D(m.cantidad).eq(1) ? f.u.nombre : f.u.plural}`;
  await registrarAuditoria(tx, autor, 'inventario', `${autor.nombre} registró una merma de ${cantidad} de ${f.p.nombre} ${f.c.nombre} (${m.motivo})`, {
    tabla: 'movimientos_inventario',
    registroId: m.id,
    fecha: ctx.creadoEnDispositivo,
  });
  return resultado(`Merma · ${f.p.nombre} ${f.c.nombre}, ${cantidad}`, revision);
}

// ── Cliente ──────────────────────────────────────────────────────────────────

async function aplicarCliente(tx: Tx, datos: unknown, ctx: ContextoAplicacion): Promise<Resultado> {
  const { autor } = ctx;
  exigirPermiso(autor, 'clientes.crear', 'agregar clientes');
  const c = parsear(esquemaCliente, datos);
  const revision = [...ctx.revisionGeneral];
  const telefono = c.telefono?.trim() || null;
  if (telefono) {
    const { rows } = await tx.execute<{ nombre: string }>(sql`
      select nombre from clientes
      where regexp_replace(coalesce(telefono, ''), '\D', '', 'g') = ${telefono.replace(/\D/g, '')} and archivado_en is null
      limit 1`);
    if (rows[0]) revision.push(`Posible duplicado de ${rows[0].nombre} (mismo teléfono).`);
  }
  await tx.insert(clientes).values({
    id: c.id,
    negocioId: autor.negocioId,
    nombre: c.nombre,
    telefono,
    ubicacion: c.ubicacion?.trim() || null,
    plazoDias: c.plazoDias,
    saldoAFavor: '0',
    creadoEn: new Date(c.creadoEn),
    requiereRevision: revision.length > 0,
  });
  await registrarAuditoria(tx, autor, 'ventas', `${autor.nombre} agregó al cliente ${c.nombre}`, { tabla: 'clientes', registroId: c.id, fecha: ctx.creadoEnDispositivo });
  return resultado(`Cliente nuevo · ${c.nombre}`, revision);
}

// ── Ingreso / egreso ─────────────────────────────────────────────────────────

async function aplicarMovimientoDinero(tx: Tx, datos: unknown, ctx: ContextoAplicacion): Promise<Resultado> {
  const { autor } = ctx;
  exigirPermiso(autor, 'dinero.registrar', 'registrar ingresos y egresos');
  const m = parsear(esquemaMovimientoDinero, datos);
  const revision = [...ctx.revisionGeneral];
  let concepto = m.concepto.trim();
  if (m.categoria === 'pago_proveedor') {
    const [prov] = m.proveedorId ? await tx.select({ nombre: proveedores.nombre }).from(proveedores).where(eq(proveedores.id, m.proveedorId)) : [];
    if (!prov) throw new Dependencia('El proveedor del pago no existe en el servidor.');
    concepto = `Pago a proveedor · ${prov.nombre}`;
  }
  if (!concepto) throw new Rechazo('El movimiento necesita un concepto.');
  const tipo = CATEGORIAS[m.categoria];
  await tx.insert(movimientosDinero).values({
    id: m.id,
    negocioId: autor.negocioId,
    tipo,
    categoria: m.categoria,
    concepto,
    monto: aImporte(m.monto),
    metodo: m.metodo,
    proveedorId: m.categoria === 'pago_proveedor' ? m.proveedorId : null,
    usuarioId: autor.id,
    usuarioNombre: autor.nombre,
    creadoEn: new Date(m.creadoEn),
  });
  await registrarAuditoria(tx, autor, 'pagos', `${autor.nombre} registró ${concepto} por ${formatoMXN(m.monto)}`, {
    tabla: 'movimientos_dinero',
    registroId: m.id,
    fecha: ctx.creadoEnDispositivo,
  });
  return resultado(`${concepto} · ${tipo === 'ingreso' ? '+' : '−'}${formatoMXN(m.monto)}`, revision);
}

const APLICADORES: Record<string, (tx: Tx, datos: unknown, ctx: ContextoAplicacion) => Promise<Resultado>> = {
  'venta.crear': aplicarVenta,
  'pago.crear': aplicarPago,
  'compra.crear': aplicarCompra,
  'merma.crear': aplicarMerma,
  'cliente.crear': aplicarCliente,
  'movimiento_dinero.crear': aplicarMovimientoDinero,
};

/** Resumen legible aunque la operación no se haya aplicado. */
export function resumenCrudo(tipo: string, datos: unknown): string {
  const d = (datos ?? {}) as Record<string, unknown>;
  const etiqueta: Record<string, string> = {
    'venta.crear': 'Venta',
    'pago.crear': 'Pago',
    'compra.crear': 'Compra',
    'merma.crear': 'Merma',
    'cliente.crear': 'Cliente nuevo',
    'movimiento_dinero.crear': 'Movimiento de dinero',
  };
  const folio = typeof d.folio === 'number' ? ` ${tipo === 'compra.crear' ? folioCompra(d.folio) : folioVenta(d.folio)}` : '';
  const quien = (d.clienteNombre ?? d.nombre ?? d.proveedorNombre) as string | undefined;
  const monto = (d.total ?? d.monto) as string | undefined;
  return `${etiqueta[tipo] ?? tipo}${folio}${quien ? ` · ${quien}` : ''}${monto ? ` · ${formatoMXN(monto)}` : ''}`;
}

/**
 * Ejecuta la operación en un savepoint: si se rechaza o le falta una dependencia,
 * no queda nada escrito y se devuelve el resultado correspondiente.
 */
export async function aplicarOperacion(tx: Tx, tipo: string, datos: unknown, ctx: ContextoAplicacion): Promise<Resultado> {
  const aplicador = APLICADORES[tipo];
  if (!aplicador) return { estado: 'rechazada', aplicada: false, motivo: 'Tipo de operación desconocido.', resultado: null, resumen: resumenCrudo(tipo, datos) };
  try {
    return await tx.transaction((sp) => aplicador(sp, datos, ctx));
  } catch (e) {
    const resumen = resumenCrudo(tipo, datos);
    if (e instanceof Rechazo) return { estado: 'rechazada', aplicada: false, motivo: e.message, resultado: null, resumen };
    if (e instanceof Dependencia) return { estado: 'en_revision', aplicada: false, motivo: e.message, resultado: null, resumen };
    const codigo = (e as { code?: string; cause?: { code?: string; constraint?: string } }).cause?.code ?? (e as { code?: string }).code;
    if (codigo === '23505') return { estado: 'rechazada', aplicada: false, motivo: 'El folio o el identificador ya se usó en otra operación.', resultado: null, resumen };
    throw e;
  }
}

export const nuevoIdOperacion = uuid;
