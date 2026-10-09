/**
 * Servidor de demostración (solo `vite --mode demo` y pruebas).
 *
 * Implementa el contrato de @micentralmx/shared/api dentro del navegador, con su propia
 * base IndexedDB separada de la del cliente. Sirve para recorrer y probar los flujos
 * del frontend sin backend; NO sustituye a la API real (Express + PostgreSQL), que
 * debe implementar las mismas reglas con RLS, transacciones y auditoría.
 */
import Dexie, { type EntityTable } from 'dexie';
import { CONFIG } from '../config';
import type {
  AccionRevision,
  AlertaInventario,
  BloqueFolio,
  OperacionEnRevision,
  DatosMerma,
  DatosProducto,
  EntradaHistorial,
  OperacionPush,
  ResumenReportes,
  RolNegocio,
  SolicitudAjuste,
  SolicitudPush,
  TipoFolio,
  UsuarioNegocio,
} from '@micentralmx/shared/api';
import type {
  Clasificacion,
  Cliente,
  Compra,
  ConfiguracionNegocio,
  MovimientoDinero,
  MovimientoInventario,
  Negocio,
  Pago,
  Producto,
  Proveedor,
  UsuarioSesion,
  Venta,
} from '@micentralmx/shared/entidades';
import type { Permiso } from '@micentralmx/shared/permisos';
import { aImporte, D, formatoMXN, sumar } from '../lib/dinero';
import { diaLocal, diferenciaDias } from '../lib/fechas';
import { nuevoId } from '../lib/ids';
import { folioCompra, folioVenta } from '../dominio/formato';
import { crearSemilla, type AuditoriaServidor, type RolServidor, type UsuarioServidor } from './semilla';

interface Registro {
  clave: string;
  tabla: string;
  id: string;
  tx: number;
  datos: unknown;
}
interface Valor {
  clave: string;
  valor: unknown;
}

class BaseServidor extends Dexie {
  registros!: EntityTable<Registro, 'clave'>;
  valores!: EntityTable<Valor, 'clave'>;
  constructor() {
    super('micentralmx-demo-servidor');
    this.version(1).stores({ registros: '&clave, tabla, tx', valores: '&clave' });
  }
}
const sdb = new BaseServidor();

/** Tablas que viajan en la bajada. */
const TABLAS_PULL = [
  'unidades',
  'productos',
  'clasificaciones',
  'existencias',
  'clientes',
  'proveedores',
  'ventas',
  'pagos',
  'compras',
  'movimientosInventario',
  'movimientosDinero',
] as const;

// ── Acceso a datos ──────────────────────────────────────────────────────────

async function valor<T>(clave: string): Promise<T | undefined> {
  return (await sdb.valores.get(clave))?.valor as T | undefined;
}
const fijarValor = (clave: string, v: unknown) => sdb.valores.put({ clave, valor: v });

async function siguienteTx(): Promise<number> {
  const tx = ((await valor<number>('tx')) ?? 0) + 1;
  await fijarValor('tx', tx);
  return tx;
}

async function guardar(tabla: string, id: string, datos: unknown) {
  await sdb.registros.put({ clave: `${tabla}:${id}`, tabla, id, tx: await siguienteTx(), datos });
}
async function obtener<T>(tabla: string, id: string): Promise<T | undefined> {
  return (await sdb.registros.get(`${tabla}:${id}`))?.datos as T | undefined;
}
async function todos<T>(tabla: string): Promise<T[]> {
  return (await sdb.registros.where('tabla').equals(tabla).toArray()).map((r) => r.datos as T);
}

async function inicializar() {
  if (await valor('inicializado')) return;
  const s = crearSemilla();
  await fijarValor('negocio', s.negocio);
  await fijarValor('configuracion', s.configuracion);
  await fijarValor('siguienteFolio', s.siguienteFolio);
  for (const tabla of TABLAS_PULL) {
    for (const fila of s[tabla] as Array<{ id?: string; clasificacionId?: string }>) {
      await guardar(tabla, (fila.id ?? fila.clasificacionId)!, fila);
    }
  }
  for (const x of s.usuarios) await guardar('usuarios', x.id, x);
  for (const x of s.roles) await guardar('roles', x.id, x);
  for (const x of s.auditoria) await guardar('auditoria', x.id, x);
  await fijarValor('inicializado', true);
}

// ── Sesión ──────────────────────────────────────────────────────────────────

class Respuesta {
  constructor(
    public estado: number,
    public datos: unknown,
  ) {}
}
const ok = (datos: unknown = null) => new Respuesta(200, datos);
const error = (estado: number, mensaje: string, codigo?: string) => new Respuesta(estado, { mensaje, codigo });

async function usuarioSesion(u: UsuarioServidor): Promise<UsuarioSesion> {
  const rol = (await obtener<RolServidor>('roles', u.rolId))!;
  return {
    id: u.id,
    nombre: u.nombre,
    usuario: u.usuario,
    rolId: rol.id,
    rolNombre: rol.nombre,
    rolBase: rol.base,
    permisos: rol.permisos as Permiso[],
  };
}

const emitirToken = (usuarioId: string) => `demo.${usuarioId}.${Date.now() + 15 * 60_000}`;

async function usuarioDelToken(token: string | null): Promise<UsuarioServidor | null> {
  const [pre, id, exp] = (token ?? '').split('.');
  if (pre !== 'demo' || !id || Number(exp) < Date.now()) return null;
  const u = await obtener<UsuarioServidor>('usuarios', id);
  return u?.activo ? u : null;
}

async function auditar(usuarioNombre: string, categoria: string, descripcion: string, fecha = new Date().toISOString()) {
  const e: AuditoriaServidor = { id: nuevoId(), fecha, usuarioNombre, categoria, descripcion };
  await guardar('auditoria', e.id, e);
}

// ── Folios ──────────────────────────────────────────────────────────────────

async function reservarBloque(dispositivoId: string, tipo: TipoFolio): Promise<BloqueFolio> {
  const sig = (await valor<Record<TipoFolio, number>>('siguienteFolio'))!;
  const b: BloqueFolio = { id: nuevoId(), tipo, desde: sig[tipo], hasta: sig[tipo] + CONFIG.tamanoBloqueFolios - 1 };
  await fijarValor('siguienteFolio', { ...sig, [tipo]: b.hasta + 1 });
  await guardar('bloquesFolio', b.id, { ...b, dispositivoId });
  return b;
}

/** Folio definitivo para una operación que llegó con folio provisional. */
async function folioDefinitivo(tipo: TipoFolio): Promise<number> {
  const sig = (await valor<Record<TipoFolio, number>>('siguienteFolio'))!;
  await fijarValor('siguienteFolio', { ...sig, [tipo]: sig[tipo] + 1 });
  return sig[tipo];
}

// ── Inventario ──────────────────────────────────────────────────────────────

async function moverExistencia(
  clasificacionId: string,
  productoId: string,
  delta: string,
  tipo: MovimientoInventario['tipo'],
  referencia: string | null,
  motivo: string | null,
  usuarioNombre: string,
  creadoEn: string,
  id = nuevoId(),
): Promise<boolean> {
  const actual = (await obtener<{ cantidad: string }>('existencias', clasificacionId))?.cantidad ?? '0';
  const nueva = D(actual).plus(delta);
  await guardar('existencias', clasificacionId, { clasificacionId, cantidad: nueva.toString() });
  await guardar('movimientosInventario', id, {
    id, clasificacionId, productoId, delta, tipo, referencia, motivo, usuarioNombre, creadoEn,
  } satisfies MovimientoInventario);
  return nueva.gte(0);
}

// ── Sincronización: aplicar operaciones ─────────────────────────────────────

interface ResultadoOp {
  estado: 'aplicada' | 'en_revision' | 'rechazada';
  motivo?: string;
  resultado?: { folio?: number };
  /** Quedó en revisión porque falta algo de lo que depende: no se aplicó. */
  sinAplicar?: boolean;
}

interface OperacionGuardada {
  hash: string;
  resultado: ResultadoOp;
  recibidoEn: string;
  op: OperacionPush;
  dispositivoId: string;
  resolucion?: 'aprobada' | 'reaplicada' | 'descartada';
  notaResolucion?: string | null;
  resueltaPor?: string;
  resueltaEn?: string;
}

async function aplicarOperacion(op: OperacionPush, usuario: UsuarioServidor, relojDesfasado: boolean): Promise<ResultadoOp> {
  const autor = await obtener<UsuarioServidor>('usuarios', op.usuario_id);
  if (!autor) return { estado: 'rechazada', motivo: 'El usuario de la operación no existe.' };
  const revision: string[] = [];
  if (!autor.activo) revision.push('El usuario estaba suspendido.');
  if (relojDesfasado) revision.push('La hora del dispositivo no era correcta.');
  const sesion = await usuarioSesion(autor);
  const puede = (p: Permiso) => sesion.permisos.includes(p);

  switch (op.tipo) {
    case 'venta.crear': {
      if (!puede('ventas.crear')) return { estado: 'rechazada', motivo: 'El usuario no tiene permiso para vender.' };
      const v = op.datos as Venta;
      if (v.clienteId && !(await obtener('clientes', v.clienteId))) {
        return { estado: 'en_revision', motivo: 'El cliente de la venta no existe en el servidor.', sinAplicar: true };
      }
      let folio = v.folio;
      let resultado: ResultadoOp['resultado'];
      if (folio == null) {
        folio = await folioDefinitivo('venta');
        resultado = { folio };
      }
      const venta: Venta = { ...v, folio, folioProvisional: v.folioProvisional, pagado: '0.00' };
      let alcanza = true;
      for (const r of venta.renglones) {
        const ok = await moverExistencia(r.clasificacionId, r.productoId, D(r.cantidad).neg().toString(), 'venta', `Venta ${folioVenta(venta)}`, null, venta.usuarioNombre, venta.creadoEnDispositivo);
        alcanza &&= ok;
      }
      if (!alcanza) revision.push('La existencia quedó negativa.');
      if (v.motivoRevision) revision.push(v.motivoRevision);
      venta.requiereRevision = revision.length > 0;
      venta.motivoRevision = revision.join(' ') || null;
      await guardar('ventas', venta.id, venta);
      await auditar(venta.usuarioNombre, 'ventas', `${venta.usuarioNombre} registró la venta ${folioVenta(venta)} por ${formatoMXN(venta.total)}`, venta.creadoEnDispositivo);
      return { estado: venta.requiereRevision ? 'en_revision' : 'aplicada', motivo: venta.motivoRevision ?? undefined, resultado };
    }
    case 'pago.crear': {
      if (!puede('pagos.registrar')) return { estado: 'rechazada', motivo: 'El usuario no tiene permiso para registrar pagos.' };
      const p = op.datos as Pago;
      const cliente = await obtener<Cliente>('clientes', p.clienteId);
      if (!cliente) return { estado: 'en_revision', motivo: 'El cliente del pago no existe en el servidor.', sinAplicar: true };
      let excedente = D(p.excedente);
      for (const a of p.aplicaciones) {
        const venta = await obtener<Venta>('ventas', a.ventaId);
        if (!venta || venta.estado === 'cancelada') {
          excedente = excedente.plus(a.monto);
          continue;
        }
        const saldo = D(venta.total).minus(venta.pagado);
        const aplicar = D(a.monto).gt(saldo) ? saldo : D(a.monto);
        excedente = excedente.plus(D(a.monto).minus(aplicar));
        const pagado = D(venta.pagado).plus(aplicar);
        await guardar('ventas', venta.id, {
          ...venta,
          pagado: aImporte(pagado),
          estado: pagado.gte(venta.total) ? 'completada' : 'a_credito',
        } satisfies Venta);
      }
      if (excedente.gt(0)) {
        revision.push(`Excedente de ${formatoMXN(excedente)} como saldo a favor.`);
        await guardar('clientes', cliente.id, { ...cliente, saldoAFavor: aImporte(D(cliente.saldoAFavor).plus(excedente)) });
      }
      await guardar('pagos', p.id, { ...p, excedente: aImporte(excedente), requiereRevision: revision.length > 0 });
      await auditar(p.usuarioNombre, 'pagos', `${p.usuarioNombre} registró un pago de ${formatoMXN(p.monto)} de ${p.clienteNombre}`, p.creadoEnDispositivo);
      return revision.length ? { estado: 'en_revision', motivo: revision.join(' ') } : { estado: 'aplicada' };
    }
    case 'compra.crear': {
      if (!puede('compras.crear')) return { estado: 'rechazada', motivo: 'El usuario no tiene permiso para registrar compras.' };
      const c = op.datos as Compra;
      let resultado: ResultadoOp['resultado'];
      const compra = { ...c };
      if (compra.folio == null) {
        compra.folio = await folioDefinitivo('compra');
        resultado = { folio: compra.folio };
      }
      for (const r of compra.renglones) {
        await moverExistencia(r.clasificacionId, r.productoId, r.cantidad, 'compra', `Compra ${folioCompra(compra)}`, null, compra.usuarioNombre, compra.creadoEnDispositivo);
        const cl = await obtener<Clasificacion>('clasificaciones', r.clasificacionId);
        if (cl) await guardar('clasificaciones', cl.id, { ...cl, ultimoCosto: r.costo });
      }
      await guardar('compras', compra.id, compra);
      await auditar(compra.usuarioNombre, 'compras', `${compra.usuarioNombre} registró la compra ${folioCompra(compra)} de ${compra.proveedorNombre}`, compra.creadoEnDispositivo);
      return revision.length ? { estado: 'en_revision', motivo: revision.join(' '), resultado } : { estado: 'aplicada', resultado };
    }
    case 'merma.crear': {
      if (!puede('inventario.merma')) return { estado: 'rechazada', motivo: 'El usuario no tiene permiso para registrar mermas.' };
      const m = op.datos as DatosMerma;
      const alcanza = await moverExistencia(m.clasificacionId, m.productoId, D(m.cantidad).neg().toString(), 'merma', null, m.motivo, autor.nombre, op.creado_en_dispositivo, m.id);
      if (!alcanza) revision.push('La existencia quedó negativa.');
      await auditar(autor.nombre, 'inventario', `${autor.nombre} registró una merma de ${m.cantidad} (${m.motivo})`, op.creado_en_dispositivo);
      return revision.length ? { estado: 'en_revision', motivo: revision.join(' ') } : { estado: 'aplicada' };
    }
    case 'cliente.crear': {
      if (!puede('clientes.crear')) return { estado: 'rechazada', motivo: 'El usuario no tiene permiso para agregar clientes.' };
      const c = op.datos as Cliente;
      const tel = (t: string | null) => (t ?? '').replace(/\D/g, '');
      if (c.telefono && (await todos<Cliente>('clientes')).some((x) => x.id !== c.id && tel(x.telefono) === tel(c.telefono))) {
        revision.push('Ya existe un cliente con ese teléfono.');
      }
      await guardar('clientes', c.id, { ...c, requiereRevision: revision.length > 0 });
      await auditar(autor.nombre, 'ventas', `${autor.nombre} agregó al cliente ${c.nombre}`, op.creado_en_dispositivo);
      return revision.length ? { estado: 'en_revision', motivo: revision.join(' ') } : { estado: 'aplicada' };
    }
    case 'movimiento_dinero.crear': {
      if (!puede('dinero.registrar')) return { estado: 'rechazada', motivo: 'El usuario no tiene permiso para registrar ingresos y egresos.' };
      const m = op.datos as MovimientoDinero;
      await guardar('movimientosDinero', m.id, m);
      await auditar(autor.nombre, 'pagos', `${autor.nombre} registró ${m.concepto} por ${formatoMXN(m.monto)}`, m.creadoEn);
      return revision.length ? { estado: 'en_revision', motivo: revision.join(' ') } : { estado: 'aplicada' };
    }
    default:
      void usuario;
      return { estado: 'rechazada', motivo: 'Tipo de operación desconocido.' };
  }
}

async function push(s: SolicitudPush, usuario: UsuarioServidor) {
  const desfasado = Math.abs(new Date(s.reloj_dispositivo).getTime() - Date.now()) > CONFIG.toleranciaRelojMs;
  const resultados = [];
  for (const op of s.operaciones) {
    // Idempotencia: UNIQUE (negocio_id, operacion_id); se guarda el resultado original.
    const previa = await obtener<OperacionGuardada>('operacionesSync', op.operacion_id);
    if (previa) {
      resultados.push(
        previa.hash === op.hash
          ? { operacion_id: op.operacion_id, motivo: previa.resultado.motivo, resultado: previa.resultado.resultado, estado: previa.resultado.estado === 'aplicada' ? 'duplicada' : previa.resultado.estado }
          : { operacion_id: op.operacion_id, estado: 'rechazada', motivo: 'La operación ya existe con otro contenido.' },
      );
      continue;
    }
    const r = await aplicarOperacion(op, usuario, desfasado);
    await guardar('operacionesSync', op.operacion_id, {
      hash: op.hash,
      resultado: r,
      recibidoEn: new Date().toISOString(),
      op,
      dispositivoId: s.dispositivo_id,
    } satisfies OperacionGuardada);
    resultados.push({ operacion_id: op.operacion_id, estado: r.estado, motivo: r.motivo, resultado: r.resultado });
  }
  await guardar('usuarios', usuario.id, { ...usuario, ultimaActividad: new Date().toISOString() });
  return { reloj_servidor: new Date().toISOString(), resultados };
}

async function pull(cursor: string, usuario: UsuarioServidor) {
  const desde = Number(cursor) || 0;
  const LIMITE = 500;
  const filas = await sdb.registros.where('tx').above(desde).limit(LIMITE + 1).toArray();
  const pagina = filas.slice(0, LIMITE);
  const cambios = Object.fromEntries(TABLAS_PULL.map((t) => [t, [] as unknown[]])) as Record<(typeof TABLAS_PULL)[number], unknown[]>;
  for (const f of pagina) {
    if ((TABLAS_PULL as readonly string[]).includes(f.tabla)) cambios[f.tabla as (typeof TABLAS_PULL)[number]].push(f.datos);
  }
  return {
    cursor: String(pagina.length ? pagina[pagina.length - 1].tx : desde),
    hay_mas: filas.length > LIMITE,
    usuario: await usuarioSesion(usuario),
    configuracion: await valor<ConfiguracionNegocio>('configuracion'),
    cambios,
  };
}

// ── Pantallas en línea ──────────────────────────────────────────────────────

async function guardarProducto(d: DatosProducto, usuario: UsuarioServidor, id?: string) {
  if (!d.nombre?.trim()) return error(422, 'Escribe el nombre del producto.');
  if (!(await obtener('unidades', d.unidadId))) return error(422, 'Elige cómo se vende el producto.');
  if (!d.clasificaciones?.length) return error(422, 'Agrega al menos una clasificación.');
  const previo = id ? await obtener<Producto>('productos', id) : undefined;
  if (id && !previo) return error(404, 'El producto no existe.');
  const producto: Producto = { id: id ?? nuevoId(), nombre: d.nombre.trim(), unidadId: d.unidadId, umbralBajo: D(d.umbralBajo || 0).toString(), archivadoEn: null };
  await guardar('productos', producto.id, producto);
  const existentes = (await todos<Clasificacion>('clasificaciones')).filter((c) => c.productoId === producto.id);
  for (const [orden, c] of d.clasificaciones.entries()) {
    const previa = existentes.find((x) => x.id === c.id);
    if (previa && !D(previa.precio).eq(c.precio)) {
      await auditar(usuario.nombre, 'catalogo', `${usuario.nombre} cambió el precio de ${producto.nombre} ${c.nombre} de ${formatoMXN(previa.precio)} a ${formatoMXN(c.precio)}`);
    }
    await guardar('clasificaciones', c.id, {
      id: c.id, productoId: producto.id, nombre: c.nombre.trim(), precio: aImporte(c.precio), ultimoCosto: previa?.ultimoCosto ?? null, orden, archivadoEn: null,
    } satisfies Clasificacion);
    if (!previa) {
      await guardar('existencias', c.id, { clasificacionId: c.id, cantidad: '0' });
      if (c.existenciaInicial && D(c.existenciaInicial).gt(0)) {
        await moverExistencia(c.id, producto.id, D(c.existenciaInicial).toString(), 'inicial', null, 'Existencia inicial', usuario.nombre, new Date().toISOString());
      }
    }
  }
  // Clasificaciones quitadas: se archivan, nunca se borran.
  for (const c of existentes.filter((x) => !d.clasificaciones.some((y) => y.id === x.id) && !x.archivadoEn)) {
    await guardar('clasificaciones', c.id, { ...c, archivadoEn: new Date().toISOString() });
  }
  await auditar(usuario.nombre, 'catalogo', `${usuario.nombre} ${id ? 'editó' : 'agregó'} el producto ${producto.nombre}`);
  return ok(producto);
}

async function resumen(desde: string, hasta: string): Promise<ResumenReportes> {
  const enRango = (iso: string) => {
    const d = diaLocal(iso);
    return d >= desde && d <= hasta;
  };
  const ventas = (await todos<Venta>('ventas')).filter((v) => v.estado !== 'cancelada');
  const delRango = ventas.filter((v) => enRango(v.creadoEnDispositivo));
  const compras = (await todos<Compra>('compras')).filter((c) => enRango(c.creadoEnDispositivo));
  const pagos = (await todos<Pago>('pagos')).filter((p) => enRango(p.creadoEnDispositivo));
  const dinero = (await todos<MovimientoDinero>('movimientosDinero')).filter((m) => enRango(m.creadoEn));
  const movs = (await todos<MovimientoInventario>('movimientosInventario')).filter((m) => m.tipo === 'merma' && enRango(m.creadoEn));
  const clasificaciones = await todos<Clasificacion>('clasificaciones');
  const productos = (await todos<Producto>('productos')).filter((p) => !p.archivadoEn);
  const existencias = await todos<{ clasificacionId: string; cantidad: string }>('existencias');
  const hoy = diaLocal();
  const abiertas = ventas.filter((v) => v.formaPago === 'credito' && D(v.total).gt(v.pagado));
  let bajos = 0;
  for (const p of productos) {
    for (const c of clasificaciones.filter((x) => x.productoId === p.id && !x.archivadoEn)) {
      const e = D(existencias.find((x) => x.clasificacionId === c.id)?.cantidad ?? 0);
      if (e.gt(0) && e.lte(p.umbralBajo)) bajos++;
    }
  }
  return {
    desde,
    hasta,
    ventas: { total: aImporte(sumar(delRango.map((v) => v.total))), cantidad: delRango.length, aCredito: delRango.filter((v) => v.formaPago === 'credito').length },
    compras: { total: aImporte(sumar(compras.map((c) => c.total))), cantidad: compras.length, proveedores: new Set(compras.map((c) => c.proveedorId)).size },
    inventario: { productos: productos.length, bajos },
    pagos: {
      ingresos: aImporte(sumar([...pagos.map((p) => p.monto), ...dinero.filter((m) => m.tipo === 'ingreso').map((m) => m.monto)])),
      egresos: aImporte(sumar(dinero.filter((m) => m.tipo === 'egreso').map((m) => m.monto))),
    },
    deudas: {
      porCobrar: aImporte(sumar(abiertas.map((v) => D(v.total).minus(v.pagado)))),
      vencido: aImporte(sumar(abiertas.filter((v) => v.venceEl && diferenciaDias(hoy, v.venceEl) < 0).map((v) => D(v.total).minus(v.pagado)))),
    },
    mermas: {
      // Valor con el último costo de compra de la clasificación (decisiones técnicas §3).
      valor: aImporte(sumar(movs.map((m) => D(m.delta).abs().times(clasificaciones.find((c) => c.id === m.clasificacionId)?.ultimoCosto ?? 0)))),
      cantidad: sumar(movs.map((m) => D(m.delta).abs())).toString(),
      unidad: 'unidades',
    },
  };
}

// ── Enrutador ───────────────────────────────────────────────────────────────

type Manejador = (p: { cuerpo: any; params: string[]; query: URLSearchParams; usuario: UsuarioServidor }) => Promise<Respuesta>;
const rutas: Array<[string, RegExp, Manejador]> = [];
const ruta = (metodo: string, patron: string, f: Manejador) =>
  rutas.push([metodo, new RegExp(`^${patron.replace(/:[a-z]+/g, '([^/]+)')}$`), f]);

const exigir = (_u: UsuarioServidor, rolPermisos: string[], p: Permiso) =>
  rolPermisos.includes(p) ? null : error(403, 'Tu rol no permite esta acción.');
async function permisos(u: UsuarioServidor) {
  return ((await obtener<RolServidor>('roles', u.rolId))?.permisos ?? []) as string[];
}

ruta('POST', '/dispositivos', async ({ usuario }) => {
  const n = ((await valor<number>('dispositivos')) ?? 0) + 1;
  await fijarValor('dispositivos', n);
  const id = nuevoId();
  await guardar('dispositivos', id, { id, codigo: `D${n}`, usuarioId: usuario.id });
  return ok({ dispositivo_id: id, codigo: `D${n}`, bloques: [await reservarBloque(id, 'venta'), await reservarBloque(id, 'compra')] });
});
ruta('POST', '/folios/bloques', async ({ cuerpo }) => ok(await reservarBloque(cuerpo.dispositivo_id, cuerpo.tipo)));
ruta('POST', '/sync/push', async ({ cuerpo, usuario }) => ok(await push(cuerpo, usuario)));
ruta('GET', '/sync/pull', async ({ query, usuario }) => ok(await pull(query.get('cursor') ?? '0', usuario)));
ruta('POST', '/auth/logout', async () => {
  await fijarValor('refresh', null);
  return ok();
});
ruta('POST', '/auth/cambiar-contrasena', async ({ cuerpo, usuario }) => {
  if (cuerpo.actual !== usuario.contrasena) return error(422, 'La contraseña actual no es correcta.');
  if (String(cuerpo.nueva ?? '').length < 8) return error(422, 'La nueva contraseña debe tener al menos 8 caracteres.');
  await guardar('usuarios', usuario.id, { ...usuario, contrasena: cuerpo.nueva });
  return ok();
});

ruta('POST', '/productos', async ({ cuerpo, usuario }) => exigir(usuario, await permisos(usuario), 'catalogo.editar') ?? guardarProducto(cuerpo, usuario));
ruta('PATCH', '/productos/:id', async ({ cuerpo, usuario, params }) => exigir(usuario, await permisos(usuario), 'catalogo.editar') ?? guardarProducto(cuerpo, usuario, params[0]));
ruta('POST', '/productos/:id/archivar', async ({ usuario, params }) => {
  const e = exigir(usuario, await permisos(usuario), 'catalogo.editar');
  if (e) return e;
  const p = await obtener<Producto>('productos', params[0]);
  if (!p) return error(404, 'El producto no existe.');
  const ahora = new Date().toISOString();
  await guardar('productos', p.id, { ...p, archivadoEn: ahora });
  for (const c of (await todos<Clasificacion>('clasificaciones')).filter((x) => x.productoId === p.id && !x.archivadoEn)) {
    await guardar('clasificaciones', c.id, { ...c, archivadoEn: ahora });
  }
  await auditar(usuario.nombre, 'catalogo', `${usuario.nombre} archivó el producto ${p.nombre}`);
  return ok();
});
ruta('POST', '/inventario/ajustes', async ({ cuerpo, usuario }) => {
  const e = exigir(usuario, await permisos(usuario), 'inventario.ajustar');
  if (e) return e;
  const d = cuerpo as SolicitudAjuste;
  const c = await obtener<Clasificacion>('clasificaciones', d.clasificacionId);
  if (!c) return error(404, 'La clasificación no existe.');
  if (!(D(d.cantidadContada).gte(0))) return error(422, 'Escribe la cantidad contada.');
  // El servidor calcula la diferencia contra la existencia vigente, no contra la del dispositivo.
  const actual = D((await obtener<{ cantidad: string }>('existencias', c.id))?.cantidad ?? 0);
  const delta = D(d.cantidadContada).minus(actual);
  if (!delta.isZero()) await moverExistencia(c.id, c.productoId, delta.toString(), 'ajuste', null, d.motivo || 'Conteo físico', usuario.nombre, new Date().toISOString());
  await auditar(usuario.nombre, 'inventario', `${usuario.nombre} ajustó ${c.nombre}: ${actual} → ${d.cantidadContada}`);
  return ok({ delta: delta.toString() });
});
ruta('POST', '/ventas/:id/cancelar', async ({ cuerpo, usuario, params }) => {
  const e = exigir(usuario, await permisos(usuario), 'ventas.cancelar');
  if (e) return e;
  const v = await obtener<Venta>('ventas', params[0]);
  if (!v) return error(404, 'La venta no existe en el servidor.');
  if (v.estado === 'cancelada') return error(409, 'La venta ya está cancelada.');
  if (D(v.pagado).gt(0)) return error(409, 'La venta tiene pagos registrados; revisa los pagos antes de cancelar.');
  const ahora = new Date().toISOString();
  for (const r of v.renglones) await moverExistencia(r.clasificacionId, r.productoId, r.cantidad, 'cancelacion', `Venta ${folioVenta(v)}`, cuerpo.motivo ?? null, usuario.nombre, ahora);
  await guardar('ventas', v.id, { ...v, estado: 'cancelada', canceladaEn: ahora });
  await auditar(usuario.nombre, 'ventas', `${usuario.nombre} canceló la venta ${folioVenta(v)}${cuerpo.motivo ? `: ${cuerpo.motivo}` : ''}`);
  return ok();
});
ruta('POST', '/ventas/:id/confirmar-transferencia', async ({ usuario, params }) => {
  const e = exigir(usuario, await permisos(usuario), 'ventas.confirmar_transferencia');
  if (e) return e;
  const v = await obtener<Venta>('ventas', params[0]);
  if (!v || v.estado !== 'por_confirmar') return error(409, 'La venta no tiene una transferencia por confirmar.');
  await guardar('ventas', v.id, { ...v, estado: 'completada' });
  await auditar(usuario.nombre, 'ventas', `${usuario.nombre} confirmó la transferencia de la venta ${folioVenta(v)}`);
  return ok();
});
ruta('GET', '/ventas/:id', async ({ params }) => {
  const v = await obtener<Venta>('ventas', params[0]);
  return v ? ok(v) : error(404, 'La venta no existe.');
});
ruta('PATCH', '/clientes/:id', async ({ cuerpo, usuario, params }) => {
  const e = exigir(usuario, await permisos(usuario), 'clientes.editar');
  if (e) return e;
  const c = await obtener<Cliente>('clientes', params[0]);
  if (!c) return error(404, 'El cliente todavía no llega al servidor. Sincroniza e inténtalo de nuevo.');
  if (!String(cuerpo.nombre ?? '').trim()) return error(422, 'Escribe el nombre del cliente.');
  await guardar('clientes', c.id, { ...c, nombre: cuerpo.nombre.trim(), telefono: cuerpo.telefono || null, ubicacion: cuerpo.ubicacion || null, plazoDias: cuerpo.plazoDias ?? null });
  await auditar(usuario.nombre, 'ventas', `${usuario.nombre} editó al cliente ${cuerpo.nombre}`);
  return ok();
});
const guardarProveedor: Manejador = async ({ cuerpo, usuario, params }) => {
  const e = exigir(usuario, await permisos(usuario), 'proveedores.gestionar');
  if (e) return e;
  if (!String(cuerpo.nombre ?? '').trim()) return error(422, 'Escribe el nombre del proveedor.');
  const id = params[0] ?? nuevoId();
  const p: Proveedor = { id, nombre: cuerpo.nombre.trim(), telefono: cuerpo.telefono || null, productos: cuerpo.productos ?? '', archivadoEn: null };
  await guardar('proveedores', id, p);
  await auditar(usuario.nombre, 'compras', `${usuario.nombre} ${params[0] ? 'editó' : 'agregó'} al proveedor ${p.nombre}`);
  return ok(p);
};
ruta('POST', '/proveedores', guardarProveedor);
ruta('PATCH', '/proveedores/:id', guardarProveedor);

ruta('GET', '/usuarios', async ({ usuario }) => {
  const e = exigir(usuario, await permisos(usuario), 'usuarios.gestionar');
  if (e) return e;
  const roles = await todos<RolServidor>('roles');
  return ok(
    (await todos<UsuarioServidor>('usuarios')).map(
      (u): UsuarioNegocio => ({
        id: u.id, nombre: u.nombre, usuario: u.usuario, rolId: u.rolId, rolNombre: roles.find((r) => r.id === u.rolId)?.nombre ?? '',
        activo: u.activo, ultimaActividad: u.ultimaActividad,
      }),
    ),
  );
});
ruta('GET', '/roles', async () => ok((await todos<RolServidor>('roles')) satisfies RolNegocio[]));
ruta('PUT', '/roles/:id', async ({ cuerpo, usuario, params }) => {
  const e = exigir(usuario, await permisos(usuario), 'usuarios.gestionar');
  if (e) return e;
  const r = await obtener<RolServidor>('roles', params[0]);
  if (!r) return error(404, 'El rol no existe.');
  if (!r.editable) return error(409, 'El rol Dueño no se puede editar.');
  await guardar('roles', r.id, { ...r, permisos: cuerpo.permisos });
  await auditar(usuario.nombre, 'usuarios', `${usuario.nombre} cambió los permisos del rol ${r.nombre}`);
  return ok({ ...r, permisos: cuerpo.permisos });
});
ruta('POST', '/usuarios', async ({ cuerpo, usuario }) => {
  const e = exigir(usuario, await permisos(usuario), 'usuarios.gestionar');
  if (e) return e;
  if (!cuerpo.nombre?.trim() || !cuerpo.usuario?.trim()) return error(422, 'Escribe el nombre y el usuario.');
  if ((cuerpo.contrasena ?? '').length < 8) return error(422, 'La contraseña debe tener al menos 8 caracteres.');
  if ((await todos<UsuarioServidor>('usuarios')).some((u) => u.usuario === cuerpo.usuario.trim())) return error(409, 'Ese usuario ya existe.');
  const nuevo: UsuarioServidor = { id: nuevoId(), nombre: cuerpo.nombre.trim(), usuario: cuerpo.usuario.trim(), contrasena: cuerpo.contrasena, rolId: cuerpo.rolId, activo: true, ultimaActividad: null };
  await guardar('usuarios', nuevo.id, nuevo);
  await auditar(usuario.nombre, 'usuarios', `${usuario.nombre} agregó al usuario ${nuevo.nombre}`);
  return ok(nuevo);
});
ruta('PATCH', '/usuarios/:id', async ({ cuerpo, usuario, params }) => {
  const e = exigir(usuario, await permisos(usuario), 'usuarios.gestionar');
  if (e) return e;
  const u = await obtener<UsuarioServidor>('usuarios', params[0]);
  if (!u) return error(404, 'El usuario no existe.');
  const rolDueno = (await todos<RolServidor>('roles')).find((r) => r.base === 'dueno')!;
  if (u.rolId === rolDueno.id && (cuerpo.activo === false || (cuerpo.rolId && cuerpo.rolId !== rolDueno.id))) {
    return error(409, 'El Dueño no se puede suspender ni cambiar de rol.');
  }
  const editado = { ...u, ...cuerpo, contrasena: cuerpo.contrasena || u.contrasena };
  await guardar('usuarios', u.id, editado);
  await auditar(usuario.nombre, 'usuarios', `${usuario.nombre} ${cuerpo.activo === false ? 'suspendió' : 'editó'} al usuario ${u.nombre}`);
  return ok(editado);
});
ruta('GET', '/historial', async ({ query, usuario }) => {
  const e = exigir(usuario, await permisos(usuario), 'historial.ver');
  if (e) return e;
  const cat = query.get('categoria');
  const q = (query.get('q') ?? '').toLowerCase();
  const entradas = (await todos<AuditoriaServidor>('auditoria'))
    .filter((x) => (!cat || x.categoria === cat) && (!q || x.descripcion.toLowerCase().includes(q)))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, 200);
  return ok(entradas as EntradaHistorial[]);
});
ruta('GET', '/configuracion', async () => ok({ ...(await valor<Negocio>('negocio')), ...(await valor<ConfiguracionNegocio>('configuracion')) }));
ruta('PATCH', '/configuracion', async ({ cuerpo, usuario }) => {
  const e = exigir(usuario, await permisos(usuario), 'configuracion.editar');
  if (e) return e;
  const horas = Number(cuerpo.ventanaOfflineHoras);
  const plazo = Number(cuerpo.plazoCreditoDias);
  if (!(horas >= 1 && horas <= 72)) return error(422, 'La ventana sin conexión debe estar entre 1 y 72 horas.');
  if (!(plazo >= 1 && plazo <= 120)) return error(422, 'El plazo de crédito debe estar entre 1 y 120 días.');
  const negocio = (await valor<Negocio>('negocio'))!;
  await fijarValor('negocio', { ...negocio, nombre: cuerpo.nombre ?? negocio.nombre, ubicacion: cuerpo.ubicacion ?? negocio.ubicacion });
  await fijarValor('configuracion', { ventanaOfflineHoras: horas, plazoCreditoDias: plazo });
  await auditar(usuario.nombre, 'configuracion', `${usuario.nombre} cambió la configuración del negocio`);
  return ok();
});
ruta('GET', '/reportes/resumen', async ({ query, usuario }) => {
  const e = exigir(usuario, await permisos(usuario), 'reportes.ver');
  if (e) return e;
  return ok(await resumen(query.get('desde') ?? diaLocal(), query.get('hasta') ?? diaLocal()));
});

// ── Revisiones ──────────────────────────────────────────────────────────────

const ETIQUETA_OP: Record<string, string> = {
  'venta.crear': 'Venta',
  'pago.crear': 'Pago',
  'compra.crear': 'Compra',
  'merma.crear': 'Merma',
  'cliente.crear': 'Cliente nuevo',
  'movimiento_dinero.crear': 'Movimiento de dinero',
};

function resumenDemo(op: OperacionPush): string {
  const d = op.datos as unknown as Record<string, unknown>;
  const conFolio = { folio: (d.folio as number | null) ?? null, folioProvisional: (d.folioProvisional as string | null) ?? null };
  const folio = conFolio.folio != null || conFolio.folioProvisional ? ` ${op.tipo === 'compra.crear' ? folioCompra(conFolio) : folioVenta(conFolio)}` : '';
  const quien = (d.clienteNombre ?? d.nombre ?? d.proveedorNombre) as string | undefined;
  const monto = (d.total ?? d.monto) as string | undefined;
  return `${ETIQUETA_OP[op.tipo] ?? op.tipo}${folio}${quien ? ` · ${quien}` : ''}${monto ? ` · ${formatoMXN(monto)}` : ''}`;
}

async function aRevision(g: OperacionGuardada): Promise<OperacionEnRevision> {
  const d = g.op.datos as unknown as { id?: string; clienteId?: string };
  const autor = await obtener<UsuarioServidor>('usuarios', g.op.usuario_id);
  const quien = g.resueltaPor ? await obtener<UsuarioServidor>('usuarios', g.resueltaPor) : undefined;
  const disp = await obtener<{ codigo: string }>('dispositivos', g.dispositivoId);
  return {
    operacionId: g.op.operacion_id,
    tipo: g.op.tipo,
    resumen: resumenDemo(g.op),
    estado: g.resultado.estado as 'en_revision' | 'rechazada',
    aplicada: g.resultado.estado !== 'rechazada' && !g.resultado.sinAplicar,
    motivo: g.resultado.motivo ?? null,
    usuarioNombre: autor?.nombre ?? null,
    dispositivoCodigo: disp?.codigo ?? null,
    creadoEnDispositivo: g.op.creado_en_dispositivo,
    recibidoEn: g.recibidoEn,
    entidadId: d.id ?? null,
    clienteId: d.clienteId ?? (g.op.tipo === 'cliente.crear' ? (d.id ?? null) : null),
    resolucion: g.resolucion ?? null,
    notaResolucion: g.notaResolucion ?? null,
    resueltaPorNombre: quien?.nombre ?? null,
    resueltaEn: g.resueltaEn ?? null,
  };
}

async function enRevision(resueltas: boolean) {
  const lista = (await todos<OperacionGuardada>('operacionesSync'))
    .filter((g) => g.op && g.resultado.estado !== 'aplicada' && !!g.resueltaEn === resueltas)
    .sort((a, b) => b.recibidoEn.localeCompare(a.recibidoEn));
  return Promise.all(lista.map(aRevision));
}

ruta('GET', '/revisiones', async ({ query, usuario }) => {
  const e = exigir(usuario, await permisos(usuario), 'revisiones.resolver');
  if (e) return e;
  return ok(await enRevision(query.get('estado') === 'resueltas'));
});
ruta('GET', '/revisiones/conteo', async ({ usuario }) => {
  const e = exigir(usuario, await permisos(usuario), 'revisiones.resolver');
  if (e) return e;
  return ok({ pendientes: (await enRevision(false)).length });
});
ruta('POST', '/revisiones/:id/resolver', async ({ cuerpo, usuario, params }) => {
  const e = exigir(usuario, await permisos(usuario), 'revisiones.resolver');
  if (e) return e;
  const g = await obtener<OperacionGuardada>('operacionesSync', params[0]);
  if (!g?.op || g.resultado.estado === 'aplicada') return error(404, 'La operación no está en revisión.');
  if (g.resueltaEn) return error(409, 'La operación ya se resolvió.');
  const aplicada = g.resultado.estado !== 'rechazada' && !g.resultado.sinAplicar;
  const accion = cuerpo?.accion as AccionRevision;
  const cierre = { resueltaPor: usuario.id, resueltaEn: new Date().toISOString(), notaResolucion: cuerpo?.nota || null };
  const entidadId = (g.op.datos as unknown as { id?: string }).id;
  if (accion === 'aprobar') {
    if (!aplicada) return error(409, 'Esta operación no se aplicó; reaplícala o descártala.');
    const tabla = ({ 'venta.crear': 'ventas', 'pago.crear': 'pagos', 'cliente.crear': 'clientes' } as Record<string, string>)[g.op.tipo];
    if (tabla && entidadId) {
      const fila = await obtener<Record<string, unknown>>(tabla, entidadId);
      if (fila) await guardar(tabla, entidadId, { ...fila, requiereRevision: false });
    }
    await guardar('operacionesSync', params[0], { ...g, ...cierre, resolucion: 'aprobada' });
  } else if (accion === 'descartar') {
    if (aplicada) return error(409, 'La operación ya está registrada; para revertirla usa la cancelación o un ajuste.');
    await guardar('operacionesSync', params[0], { ...g, ...cierre, resolucion: 'descartada' });
  } else if (accion === 'reaplicar') {
    if (aplicada || g.resultado.estado === 'rechazada') return error(409, 'Solo se reaplican operaciones que esperaban un registro faltante.');
    const r = await aplicarOperacion(g.op, usuario, false);
    if (r.sinAplicar || r.estado === 'rechazada') return error(409, r.motivo ?? 'No se pudo aplicar.');
    await guardar('operacionesSync', params[0], r.estado === 'en_revision' ? { ...g, resultado: r } : { ...g, resultado: r, ...cierre, resolucion: 'reaplicada' });
  } else {
    return error(422, 'Acción inválida.');
  }
  const verbo = { aprobar: 'aprobó', reaplicar: 'reaplicó', descartar: 'descartó' }[accion];
  await auditar(usuario.nombre, 'revisiones', `${usuario.nombre} ${verbo} ${resumenDemo(g.op)}`);
  return ok(await aRevision((await obtener<OperacionGuardada>('operacionesSync', params[0]))!));
});

// ── Conciliación de existencias (en el demo se calcula al momento) ──────────

async function descuadres(): Promise<AlertaInventario[]> {
  const movs = await todos<MovimientoInventario>('movimientosInventario');
  const clasificaciones = await todos<Clasificacion>('clasificaciones');
  const productos = await todos<Producto>('productos');
  const unidadesDemo = await todos<{ id: string; plural: string }>('unidades');
  const existencias = await todos<{ clasificacionId: string; cantidad: string }>('existencias');
  const resultado: AlertaInventario[] = [];
  for (const e of existencias) {
    const suma = movs.filter((m) => m.clasificacionId === e.clasificacionId).reduce((a, m) => a.plus(m.delta), D(0));
    if (suma.eq(e.cantidad)) continue;
    const c = clasificaciones.find((x) => x.id === e.clasificacionId);
    const p = productos.find((x) => x.id === c?.productoId);
    resultado.push({
      id: e.clasificacionId,
      clasificacionId: e.clasificacionId,
      productoId: p?.id ?? '',
      descripcion: `${p?.nombre ?? 'Producto'} · ${c?.nombre ?? ''}`,
      unidadPlural: unidadesDemo.find((u) => u.id === p?.unidadId)?.plural ?? '',
      existencia: e.cantidad,
      sumaMovimientos: suma.toString(),
      detectadaEn: new Date().toISOString(),
    });
  }
  return resultado;
}

ruta('GET', '/inventario/alertas', async ({ usuario }) => exigir(usuario, await permisos(usuario), 'inventario.ajustar') ?? ok(await descuadres()));
ruta('POST', '/inventario/conciliar', async ({ usuario }) => exigir(usuario, await permisos(usuario), 'inventario.ajustar') ?? ok({ abiertas: (await descuadres()).length, cerradas: 0 }));
ruta('POST', '/inventario/alertas/:id/corregir', async ({ usuario, params }) => {
  const e = exigir(usuario, await permisos(usuario), 'inventario.ajustar');
  if (e) return e;
  const a = (await descuadres()).find((x) => x.id === params[0]);
  if (!a) return error(409, 'La existencia ya coincide con su historial.');
  await guardar('existencias', a.clasificacionId, { clasificacionId: a.clasificacionId, cantidad: a.sumaMovimientos });
  await auditar(usuario.nombre, 'inventario', `${usuario.nombre} igualó la existencia de ${a.descripcion} a su historial: ${a.existencia} → ${a.sumaMovimientos}`);
  return ok({ existencia: a.sumaMovimientos });
});

/** Punto de entrada que usa el transporte demo de src/api/cliente.ts. */
export async function manejarSolicitud(metodo: string, rutaCompleta: string, cuerpo: unknown, token: string | null) {
  // Latencia mínima para que los estados "Sincronizando…" sean visibles.
  await new Promise((r) => setTimeout(r, 120));
  const [camino, consulta = ''] = rutaCompleta.split('?');
  return sdb.transaction('rw', sdb.registros, sdb.valores, async () => {
    await inicializar();
    const negocio = (await valor<Negocio>('negocio'))!;

    if (metodo === 'GET' && camino === '/salud') return ok({ ok: true });
    if (metodo === 'POST' && camino === '/auth/login') {
      const c = cuerpo as { usuario: string; contrasena: string };
      const u = (await todos<UsuarioServidor>('usuarios')).find((x) => x.usuario === c.usuario?.trim().toLowerCase());
      if (!u || u.contrasena !== c.contrasena) return error(401, 'Usuario o contraseña incorrectos.');
      if (!u.activo) return error(403, 'Tu usuario está suspendido. Habla con el administrador.');
      await fijarValor('refresh', u.id);
      await guardar('usuarios', u.id, { ...u, ultimaActividad: new Date().toISOString() });
      return ok({ access_token: emitirToken(u.id), usuario: await usuarioSesion(u), negocio, configuracion: await valor('configuracion') });
    }
    if (metodo === 'POST' && camino === '/auth/refresh') {
      const id = await valor<string | null>('refresh');
      const u = id ? await obtener<UsuarioServidor>('usuarios', id) : undefined;
      if (!u?.activo) return error(401, 'La sesión expiró.');
      return ok({ access_token: emitirToken(u.id) });
    }

    const usuario = await usuarioDelToken(token);
    if (!usuario) return error(401, 'La sesión expiró.');
    for (const [m, patron, f] of rutas) {
      const coincide = m === metodo ? patron.exec(camino) : null;
      if (coincide) return f({ cuerpo, params: coincide.slice(1), query: new URLSearchParams(consulta), usuario });
    }
    return error(404, `Ruta no disponible: ${metodo} ${camino}`);
  });
}

/** Solo pruebas: borra el servidor de demostración. */
export async function reiniciarServidorDemo() {
  await sdb.transaction('rw', sdb.registros, sdb.valores, async () => {
    await sdb.registros.clear();
    await sdb.valores.clear();
  });
}
