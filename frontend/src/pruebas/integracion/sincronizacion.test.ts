/**
 * Pruebas del núcleo offline contra el servidor de demostración, que implementa el
 * mismo contrato que debe cumplir la API real. No prueban la API real.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { api, fijarToken, usarTransporte } from '../../api/cliente';
import type { OperacionEnRevision, UsuarioNegocio } from '@micentralmx/shared/api';
import { cerrarSesion, ErrorSesion, iniciarSesion, restaurarSesion } from '../../auth/sesion';
import { db } from '../../db/db';
import { catalogo, clientesVista, existenciasEfectivas, ventaVista } from '../../dominio/consultas';
import { ErrorValidacion } from '../../dominio/errores';
import { guardarConfiguracion } from '../../dominio/enLinea';
import {
  crearCliente,
  registrarCarga,
  registrarCompra,
  registrarMerma,
  registrarMovimientoDinero,
  registrarPago,
  registrarVenta,
} from '../../dominio/operaciones';
import { diaLocal, sumarDias } from '../../lib/fechas';
import { manejarSolicitud, reiniciarServidorDemo } from '../../demo/servidor';
import { sincronizar } from '../../sync/motor';


usarTransporte((m, r, c, t) => manejarSolicitud(m, r, c, t));

async function entrar(usuario: string) {
  await iniciarSesion(usuario, 'demo1234');
  await sincronizar();
}

async function clasificacion(producto: string, nombre: string) {
  const p = (await catalogo()).find((x) => x.producto.nombre === producto)!;
  return p.clasificaciones.find((c) => c.clasificacion.nombre === nombre)!;
}

beforeEach(async () => {
  fijarToken(null);
  await db.delete();
  await db.open();
  await reiniciarServidorDemo();
});

describe('motor de sincronización', () => {
  it('una corrida sin dispositivo registrado no bloquea las siguientes', async () => {
    // Ocurre al iniciar sesión: el motor arranca antes de que termine el registro del dispositivo.
    await sincronizar();
    await entrar('ana');
    expect(await db.productos.count()).toBeGreaterThan(0);
  });

  it('una petición durante otra corrida programa una vuelta más', async () => {
    await iniciarSesion('ana', 'demo1234');
    const primera = sincronizar({ soloSubir: true });
    const segunda = sincronizar();
    await Promise.all([primera, segunda]);
    expect(await db.productos.count()).toBeGreaterThan(0);
  });
});

describe('folios por bloques', () => {
  it('registra el dispositivo con un bloque y usa folios definitivos sin conexión', async () => {
    await entrar('ana');
    const bloques = await db.bloquesFolio.where('tipo').equals('venta').toArray();
    expect(bloques[0]).toMatchObject({ desde: 129, hasta: 228 });

    const segunda = await clasificacion('Jitomate Saladette', 'Segunda / Mediano');
    const venta = await registrarVenta({
      renglones: [{ clasificacionId: segunda.clasificacion.id, cantidad: '5', precio: '340' }],
      clienteId: null, formaPago: 'efectivo', venceEl: null, enLinea: false, motivoSinExistencia: null,
    });
    expect(venta.folio).toBe(129);
    expect(venta.folioProvisional).toBeNull();
  });

  it('usa folio provisional al agotar el bloque y el servidor asigna el definitivo', async () => {
    await entrar('ana');
    await db.bloquesFolio.toCollection().modify((b) => {
      b.siguiente = b.hasta + 1;
    });
    const segunda = await clasificacion('Jitomate Saladette', 'Segunda / Mediano');
    const venta = await registrarVenta({
      renglones: [{ clasificacionId: segunda.clasificacion.id, cantidad: '1', precio: '340' }],
      clienteId: null, formaPago: 'efectivo', venceEl: null, enLinea: false, motivoSinExistencia: null,
    });
    expect(venta.folio).toBeNull();
    expect(venta.folioProvisional).toBe('D1-P0001');
    await sincronizar();
    expect((await db.ventas.get(venta.id))!.folio).toBeGreaterThan(228);
  });
});

describe('stock insuficiente', () => {
  it('sin conexión permite vender y el servidor marca revisión al quedar negativo', async () => {
    await entrar('carlos');
    const segunda = await clasificacion('Jitomate Saladette', 'Segunda / Mediano');
    expect(segunda.existencia.toString()).toBe('35');
    const venta = await registrarVenta({
      renglones: [{ clasificacionId: segunda.clasificacion.id, cantidad: '40', precio: '340' }],
      clienteId: null, formaPago: 'efectivo', venceEl: null, enLinea: false, motivoSinExistencia: null,
    });
    expect((await existenciasEfectivas()).get(segunda.clasificacion.id)!.toString()).toBe('-5');

    await sincronizar();
    const op = (await db.operaciones.toArray())[0];
    expect(op.estado).toBe('en_revision');
    // Tras la bajada el snapshot ya incluye la venta: no se cuenta dos veces.
    expect((await existenciasEfectivas()).get(segunda.clasificacion.id)!.toString()).toBe('-5');
    expect((await ventaVista(venta.id))!.requiereRevision).toBe(true);
  });

  it('en línea bloquea a quien no tiene permiso', async () => {
    await entrar('carlos');
    const segunda = await clasificacion('Jitomate Saladette', 'Segunda / Mediano');
    await expect(
      registrarVenta({
        renglones: [{ clasificacionId: segunda.clasificacion.id, cantidad: '40', precio: '340' }],
        clienteId: null, formaPago: 'efectivo', venceEl: null, enLinea: true, motivoSinExistencia: null,
      }),
    ).rejects.toThrow(ErrorValidacion);
  });

  it('en línea permite con permiso y motivo, y deja la venta en revisión', async () => {
    await entrar('ana');
    const segunda = await clasificacion('Jitomate Saladette', 'Segunda / Mediano');
    const entrada = {
      renglones: [{ clasificacionId: segunda.clasificacion.id, cantidad: '40', precio: '340' }],
      clienteId: null, formaPago: 'efectivo' as const, venceEl: null, enLinea: true, motivoSinExistencia: null,
    };
    await expect(registrarVenta(entrada)).rejects.toThrow('motivo');
    const venta = await registrarVenta({ ...entrada, motivoSinExistencia: 'Mercancía en el camión' });
    expect(venta.requiereRevision).toBe(true);
  });

  it('el trabajador no puede cambiar el precio aplicado', async () => {
    await entrar('carlos');
    const segunda = await clasificacion('Jitomate Saladette', 'Segunda / Mediano');
    await expect(
      registrarVenta({
        renglones: [{ clasificacionId: segunda.clasificacion.id, cantidad: '1', precio: '300' }],
        clienteId: null, formaPago: 'efectivo', venceEl: null, enLinea: false, motivoSinExistencia: null,
      }),
    ).rejects.toThrow('precio');
  });
});

describe('idempotencia', () => {
  it('un reenvío de la misma operación no la duplica', async () => {
    await entrar('ana');
    const primera = await clasificacion('Aguacate Hass', 'Primera / Grande');
    await registrarVenta({
      renglones: [{ clasificacionId: primera.clasificacion.id, cantidad: '4', precio: '650' }],
      clienteId: null, formaPago: 'efectivo', venceEl: null, enLinea: true, motivoSinExistencia: null,
    });
    await sincronizar();
    // Simula que la respuesta se perdió: la operación vuelve a la cola y se reenvía.
    await db.operaciones.toCollection().modify({ estado: 'pendiente', respondidaEn: null });
    await sincronizar();
    expect((await db.operaciones.toArray())[0].estado).toBe('sincronizada');
    expect((await existenciasEfectivas()).get(primera.clasificacion.id)!.toString()).toBe('20');
  });
});

describe('pagos', () => {
  it('aplica a la deuda que vence antes y manda el excedente a revisión', async () => {
    await entrar('ana');
    const juan = (await clientesVista()).find((c) => c.cliente.nombre === 'Juan Pérez')!;
    expect(juan.saldo.toString()).toBe('2750');
    const pago = await registrarPago({ clienteId: juan.cliente.id, monto: '3250', metodo: 'efectivo', nota: null, ventaId: null });
    expect(pago.excedente).toBe('500.00');
    expect(pago.requiereRevision).toBe(true);
    expect((await clientesVista()).find((c) => c.cliente.id === juan.cliente.id)!.saldo.toString()).toBe('0');
    await sincronizar();
    expect((await db.operaciones.toArray())[0].estado).toBe('en_revision');
    expect((await clientesVista()).find((c) => c.cliente.id === juan.cliente.id)!.saldo.toString()).toBe('0');
  });
});

describe('revisiones (servidor de demostración)', () => {
  it('lista la venta que dejó existencia negativa y permite aprobarla', async () => {
    await entrar('ana');
    const segunda = await clasificacion('Jitomate Saladette', 'Segunda / Mediano');
    const venta = await registrarVenta({
      renglones: [{ clasificacionId: segunda.clasificacion.id, cantidad: '40', precio: '340' }],
      clienteId: null, formaPago: 'efectivo', venceEl: null, enLinea: false, motivoSinExistencia: null,
    });
    await sincronizar();
    const op = (await db.operaciones.toArray())[0];
    const pendientes = await api<OperacionEnRevision[]>('GET', '/revisiones');
    expect(pendientes.map((p) => p.operacionId)).toContain(op.operacionId);
    expect(pendientes[0].aplicada).toBe(true);
    await expect(api('POST', `/revisiones/${op.operacionId}/resolver`, { accion: 'descartar' })).rejects.toThrow();
    const r = await api<OperacionEnRevision>('POST', `/revisiones/${op.operacionId}/resolver`, { accion: 'aprobar' });
    expect(r.resolucion).toBe('aprobada');
    await sincronizar();
    expect((await ventaVista(venta.id))!.venta.requiereRevision).toBe(false);
  });
});

describe('sesión', () => {
  it('HU-123: actualiza los datos del negocio en la sesión actual', async () => {
    await entrar('ana');

    await guardarConfiguracion({
      nombre: 'Bodega Actualizada',
      telefono: '55 9876 5432',
      ubicacion: 'Nave II',
      ventanaOfflineHoras: 24,
      plazoCreditoDias: 7,
    });

    expect((await db.leerMeta('sesion'))?.negocio).toMatchObject({
      nombre: 'Bodega Actualizada',
      telefono: '55 9876 5432',
      ubicacion: 'Nave II',
    });
  });

  it('HU-006: impide entrar al usuario inactivo y vuelve a permitirlo al reactivarlo', async () => {
    await entrar('ana');
    const usuarios = await api<UsuarioNegocio[]>('GET', '/usuarios');
    const luis = usuarios.find((u) => u.usuario === 'luis')!;
    await api('PATCH', `/usuarios/${luis.id}`, { activo: false });
    await cerrarSesion();

    await expect(iniciarSesion('luis', 'demo1234')).rejects.toMatchObject({ estado: 403 });

    await iniciarSesion('ana', 'demo1234');
    await api('PATCH', `/usuarios/${luis.id}`, { activo: true });
    await cerrarSesion();
    await expect(iniciarSesion('luis', 'demo1234')).resolves.toMatchObject({ usuario: { id: luis.id } });
  });

  it('HU-005: cerrar sesión elimina el contexto local e invalida el acceso posterior', async () => {
    await entrar('ana');

    await cerrarSesion();

    expect(await db.leerMeta('sesion')).toBeUndefined();
    await expect(api('GET', '/configuracion')).rejects.toMatchObject({ estado: 401 });
  });

  it('elimina la sesión local cuando el servidor informa que dejó de ser válida', async () => {
    await entrar('ana');
    expect(await db.leerMeta('sesion')).toBeDefined();

    // Invalida el refresh del servidor sin ejecutar el cierre local.
    await api('POST', '/auth/logout', {});
    await restaurarSesion();

    expect(await db.leerMeta('sesion')).toBeUndefined();
  });

  it('no permite cerrar sesión con operaciones pendientes', async () => {
    await entrar('ana');
    const segunda = await clasificacion('Jitomate Saladette', 'Segunda / Mediano');
    Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    await registrarVenta({
      renglones: [{ clasificacionId: segunda.clasificacion.id, cantidad: '1', precio: '340' }],
      clienteId: null, formaPago: 'efectivo', venceEl: null, enLinea: false, motivoSinExistencia: null,
    });
    await expect(cerrarSesion()).rejects.toThrow(ErrorSesion);
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
  });

  it('pasa a solo lectura al vencer la ventana sin conexión', async () => {
    await entrar('ana');
    await db.guardarMeta('ultimoContacto', new Date(Date.now() - 25 * 3_600_000).toISOString());
    const segunda = await clasificacion('Jitomate Saladette', 'Segunda / Mediano');
    await expect(
      registrarVenta({
        renglones: [{ clasificacionId: segunda.clasificacion.id, cantidad: '1', precio: '340' }],
        clienteId: null, formaPago: 'efectivo', venceEl: null, enLinea: false, motivoSinExistencia: null,
      }),
    ).rejects.toThrow(ErrorSesion);
  });
});

const esperarTick = () => new Promise((r) => setTimeout(r, 2));

describe('sincronización completa (7 operaciones offline y segundo dispositivo)', () => {
  it('sincroniza las 7 operaciones offline sin duplicados y las replica completas en un segundo dispositivo', async () => {
    await entrar('rodolfo');

    const cJitPri = await clasificacion('Jitomate Saladette', 'Primera / Grande');
    const cAguaPri = await clasificacion('Aguacate Hass', 'Primera / Grande');
    const proveedores = await db.proveedores.toArray();
    const donAle = proveedores.find((p) => p.nombre.includes('Don Ale'))!;
    const agricola = proveedores.find((p) => p.nombre.includes('Agrícola'))!;
    const stockInicial = await existenciasEfectivas();
    const stockJitAntes = stockInicial.get(cJitPri.clasificacion.id)!;
    const stockAguaAntes = stockInicial.get(cAguaPri.clasificacion.id)!;

    let cliente!: Awaited<ReturnType<typeof crearCliente>>;
    let carga!: Awaited<ReturnType<typeof registrarCarga>>;
    let compra!: Awaited<ReturnType<typeof registrarCompra>>;
    let venta!: Awaited<ReturnType<typeof registrarVenta>>;
    let pago!: Awaited<ReturnType<typeof registrarPago>>;
    let merma!: Awaited<ReturnType<typeof registrarMerma>>;
    let mov!: Awaited<ReturnType<typeof registrarMovimientoDinero>>;

    try {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });

      cliente = await crearCliente({
        nombre: 'Cremería La Esperanza',
        telefono: '55 8899 1122',
        ubicacion: 'Pasillo H',
        plazoDias: 7,
      });
      await esperarTick();

      carga = await registrarCarga({
        fecha: diaLocal(),
        proveedorId: donAle.id,
        renglones: [{ clasificacionId: cJitPri.clasificacion.id, cantidad: '10' }],
      });
      await esperarTick();

      compra = await registrarCompra({
        proveedorId: agricola.id,
        renglones: [{ clasificacionId: cAguaPri.clasificacion.id, cantidad: '6', costo: '520' }],
        formaPago: 'contado',
        venceEl: null,
      });
      await esperarTick();

      venta = await registrarVenta({
        renglones: [{ clasificacionId: cJitPri.clasificacion.id, cantidad: '3', precio: cJitPri.clasificacion.precio }],
        clienteId: cliente.id,
        formaPago: 'credito',
        venceEl: sumarDias(diaLocal(), 7),
        enLinea: false,
        motivoSinExistencia: null,
      });
      await esperarTick();

      pago = await registrarPago({
        clienteId: cliente.id,
        monto: '500',
        metodo: 'transferencia',
        nota: 'Abono offline inicial',
        ventaId: venta.id,
      });
      await esperarTick();

      merma = await registrarMerma({
        clasificacionId: cAguaPri.clasificacion.id,
        cantidad: '1',
        motivo: 'Producto dañado',
        nota: 'Caja golpeada',
        cargaId: null,
      });
      await esperarTick();

      mov = await registrarMovimientoDinero({
        categoria: 'flete',
        concepto: 'Flete nocturno offline',
        monto: '450',
        metodo: 'efectivo',
        proveedorId: null,
      });

      const opsPendientes = await db.operaciones.toArray();
      expect(opsPendientes).toHaveLength(7);
      expect(opsPendientes.every((op) => op.estado === 'pendiente')).toBe(true);
      expect(opsPendientes.map((op) => op.tipo)).toEqual([
        'cliente.crear',
        'carga',
        'compra.crear',
        'venta.crear',
        'pago.crear',
        'merma.crear',
        'movimiento_dinero.crear',
      ]);

      const stockOffline = await existenciasEfectivas();
      expect(stockOffline.get(cJitPri.clasificacion.id)!.toString()).toBe(stockJitAntes.plus(7).toString());
      expect(stockOffline.get(cAguaPri.clasificacion.id)!.toString()).toBe(stockAguaAntes.plus(5).toString());
    } finally {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
    }

    await sincronizar();
    const opsSincronizadas = await db.operaciones.toArray();
    expect(opsSincronizadas).toHaveLength(7);
    expect(opsSincronizadas.every((op) => op.estado === 'sincronizada')).toBe(true);

    const stockPostSync = await existenciasEfectivas();
    expect(stockPostSync.get(cJitPri.clasificacion.id)!.toString()).toBe(stockJitAntes.plus(7).toString());
    expect(stockPostSync.get(cAguaPri.clasificacion.id)!.toString()).toBe(stockAguaAntes.plus(5).toString());

    // Idempotencia global: reenviar todas las operaciones no duplica existencias ni pagos.
    await db.operaciones.toCollection().modify({ estado: 'pendiente', respondidaEn: null });
    await sincronizar();
    expect((await db.operaciones.toArray()).every((op) => op.estado === 'sincronizada')).toBe(true);
    const stockReenvio = await existenciasEfectivas();
    expect(stockReenvio.get(cJitPri.clasificacion.id)!.toString()).toBe(stockJitAntes.plus(7).toString());
    expect(stockReenvio.get(cAguaPri.clasificacion.id)!.toString()).toBe(stockAguaAntes.plus(5).toString());
    expect((await db.ventas.get(venta.id))!.pagado).toBe('500.00');

    // Simular un segundo dispositivo completamente limpio (sin reiniciar el servidor demo).
    fijarToken(null);
    await db.delete();
    await db.open();
    await entrar('ana');

    expect(await db.clientes.get(cliente.id)).toMatchObject({ nombre: 'Cremería La Esperanza' });
    expect(await db.cargas.get(carga.id)).toBeDefined();
    expect((await db.existenciasCarga.toArray()).some((e) => e.cargaId === carga.id)).toBe(true);
    expect(await db.compras.get(compra.id)).toBeDefined();
    expect((await db.clasificaciones.get(cAguaPri.clasificacion.id))!.ultimoCosto).toBe('520.00');
    expect(await db.ventas.get(venta.id)).toMatchObject({
      clienteId: cliente.id,
      pagado: '500.00',
      estado: 'a_credito',
    });
    expect(await db.pagos.get(pago.id)).toMatchObject({
      clienteId: cliente.id,
      monto: '500.00',
      nota: 'Abono offline inicial',
    });
    expect(await db.movimientosInventario.get(merma.id)).toMatchObject({
      tipo: 'merma',
      delta: '-1',
      motivo: 'Producto dañado',
    });
    expect(await db.movimientosDinero.get(mov.id)).toMatchObject({
      concepto: 'Flete nocturno offline',
      monto: '450.00',
      metodo: 'efectivo',
    });

    const stockSegundoDisp = await existenciasEfectivas();
    expect(stockSegundoDisp.get(cJitPri.clasificacion.id)!.toString()).toBe(stockJitAntes.plus(7).toString());
    expect(stockSegundoDisp.get(cAguaPri.clasificacion.id)!.toString()).toBe(stockAguaAntes.plus(5).toString());

    expect(await db.unidades.count()).toBeGreaterThan(0);
    expect(await db.productos.count()).toBeGreaterThan(0);
    expect(await db.clasificaciones.count()).toBeGreaterThan(0);
    expect(await db.existencias.count()).toBeGreaterThan(0);
    expect(await db.proveedores.count()).toBeGreaterThan(0);
    expect(await db.liquidaciones.count()).toBeGreaterThan(0);
    expect(await db.liquidacionRenglones.count()).toBeGreaterThan(0);
    expect(await db.liquidacionConceptos.count()).toBeGreaterThan(0);
  });
});
