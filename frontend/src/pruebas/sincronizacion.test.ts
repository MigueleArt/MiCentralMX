/**
 * Pruebas del núcleo offline contra el servidor de demostración, que implementa el
 * mismo contrato que debe cumplir la API real. No prueban la API real.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { api, fijarToken, usarTransporte } from '../api/cliente';
import type { OperacionEnRevision } from '@micentralmx/shared/api';
import { cerrarSesion, ErrorSesion, iniciarSesion } from '../auth/sesion';
import { db } from '../db/db';
import { catalogo, clientesVista, existenciasEfectivas, ventaVista } from '../dominio/consultas';
import { ErrorValidacion } from '../dominio/errores';
import { registrarPago, registrarVenta } from '../dominio/operaciones';
import { manejarSolicitud, reiniciarServidorDemo } from '../demo/servidor';
import { sincronizar } from '../sync/motor';

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
