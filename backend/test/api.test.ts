/**
 * Pruebas de la API contra PostgreSQL real (base desechable micentralmx_prueba).
 * Cubren las pruebas obligatorias de la sincronización (propuesta §10) y las decisiones técnicas §4.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { reiniciarLimites } from '../src/auth/rutas';
import { cerrarPools } from '../src/db/pool';
import { crearNegocio } from '../src/modulos/plataforma';
import { app, bajar, clasificacion, empujar, entrar, operacion, venta } from './ayuda';
import request from 'supertest';

afterAll(() => cerrarPools());
beforeEach(async () => {
  await reiniciarLimites();
});

describe('autenticación', () => {
  it('rechaza credenciales incorrectas y limita intentos', async () => {
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ usuario: 'ana', contrasena: 'mala' }).expect(401);
    const r = await request(app).post('/api/auth/login').send({ usuario: 'ana', contrasena: 'demo1234' });
    expect(r.status).toBe(429);
  });

  it('rota el refresh token: uno usado ya no sirve', async () => {
    const agente = request.agent(app);
    const login = await agente.post('/api/auth/login').send({ usuario: 'ana', contrasena: 'demo1234' }).expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('mc_refresh='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    await agente.post('/api/auth/refresh').expect(200);
    // El cookie original (ya rotado) se rechaza.
    await request(app).post('/api/auth/refresh').set('Cookie', cookie.split(';')[0]).expect(401);
  });

  it('exige token válido en las rutas del negocio', async () => {
    await request(app).get('/api/sync/pull?cursor=0').expect(401);
    await request(app).get('/api/sync/pull?cursor=0').set('Authorization', 'Bearer basura').expect(401);
  });
});

describe('aislamiento por negocio (RLS)', () => {
  it('mc_app no ve filas sin negocio fijado ni las de otro negocio', async () => {
    const ana = await entrar('ana');
    const owner = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
    const otro = await crearNegocio(drizzle(owner), { nombre: 'Otra bodega', ubicacion: null, dueno: { nombre: 'Otra Persona', usuario: `otra-${uuid().slice(-6)}`, contrasena: 'demo12345' } });
    await owner.end();

    const app_ = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const cliente = await app_.connect();
    try {
      // Sin negocio fijado: ninguna fila.
      expect((await cliente.query('select count(*)::int as n from ventas')).rows[0].n).toBe(0);
      await cliente.query('begin');
      await cliente.query(`select set_config('app.negocio_id', $1, true)`, [otro.negocioId]);
      expect((await cliente.query('select count(*)::int as n from ventas')).rows[0].n).toBe(0);
      expect((await cliente.query('select count(*)::int as n from usuarios')).rows[0].n).toBe(1);
      // No puede escribir filas de otro negocio.
      await expect(
        cliente.query(`insert into proveedores (id, negocio_id, nombre) values ($1, $2, 'Intruso')`, [uuid(), ana.negocioId]),
      ).rejects.toThrow(/row-level security/);
      await cliente.query('rollback');
    } finally {
      cliente.release();
      await app_.end();
    }

    // Por la API: un usuario del otro negocio no encuentra la venta de Ana.
    const ventaAna = (await bajar(ana)).cambios.ventas[0];
    const intruso = await entrar(await nombreDueno(otro.negocioId), 'demo12345');
    await intruso.get(`/ventas/${ventaAna.id}`).expect(404);
    expect((await bajar(intruso)).cambios.ventas).toHaveLength(0);
  });
});

async function nombreDueno(negocioId: string) {
  const p = new pg.Pool({ connectionString: process.env.DATABASE_OWNER_URL });
  const r = await drizzle(p).execute<{ usuario: string }>(sql`select usuario from usuarios where negocio_id = ${negocioId} limit 1`);
  await p.end();
  return r.rows[0].usuario;
}

describe('sincronización', () => {
  it('aplica una venta con folio del bloque y responde duplicada al reenviarla', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Aguacate Hass', 'Primera / Grande');
    const v = venta(ana, [{ clasificacionId: c.id, cantidad: '2', precio: c.precio }]);
    const op = operacion(ana, 'venta.crear', v);
    expect((await empujar(ana, [op]))[0].estado).toBe('aplicada');
    // Pérdida de respuesta y reintento: no se duplica.
    expect((await empujar(ana, [op]))[0].estado).toBe('duplicada');
    // Mismo id con otro contenido: se rechaza.
    expect((await empujar(ana, [{ ...op, hash: 'f'.repeat(64) }]))[0].estado).toBe('rechazada');
    expect((await clasificacion(ana, 'Aguacate Hass', 'Primera / Grande')).existencia).toBe(c.existencia - 2);
  });

  it('rechaza folios de otro dispositivo y asigna definitivo a los provisionales', async () => {
    const ana = await entrar('ana');
    const carlos = await entrar('carlos');
    const c = await clasificacion(ana, 'Chile serrano', 'Única');
    const ajeno = venta(ana, [{ clasificacionId: c.id, cantidad: '1', precio: c.precio }], { folio: carlos.bloques[0].desde });
    const [r1] = await empujar(ana, [operacion(ana, 'venta.crear', ajeno)]);
    expect(r1.estado).toBe('rechazada');
    const provisional = venta(ana, [{ clasificacionId: c.id, cantidad: '1.5', precio: c.precio }], { folio: null, folioProvisional: 'D1-P0001' });
    const [r2] = await empujar(ana, [operacion(ana, 'venta.crear', provisional)]);
    expect(r2.estado).toBe('aplicada');
    expect(r2.resultado?.folio).toBeGreaterThan(0);
  });

  it('dos dispositivos venden la misma mercancía sin conexión: se aplica todo y la que deja negativo queda en revisión', async () => {
    const ana = await entrar('ana');
    const luis = await entrar('luis');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Tercera / Chico');
    const mitad = String(Math.ceil(c.existencia / 2) + 1);
    const [a] = await empujar(ana, [operacion(ana, 'venta.crear', venta(ana, [{ clasificacionId: c.id, cantidad: mitad, precio: c.precio }]))]);
    const [b] = await empujar(luis, [operacion(luis, 'venta.crear', venta(luis, [{ clasificacionId: c.id, cantidad: mitad, precio: c.precio }]))]);
    expect(a.estado).toBe('aplicada');
    expect(b.estado).toBe('en_revision');
    expect(b.motivo).toMatch(/negativa/);
    expect((await clasificacion(ana, 'Jitomate Saladette', 'Tercera / Chico')).existencia).toBe(c.existencia - 2 * Number(mitad));
  });

  it('el trabajador no puede cambiar el precio aplicado', async () => {
    const carlos = await entrar('carlos');
    const c = await clasificacion(carlos, 'Limón persa', 'Primera / Grande');
    const v = venta(carlos, [{ clasificacionId: c.id, cantidad: '1', precio: '1.00' }]);
    v.renglones[0].precioReferencia = c.precio;
    const [r] = await empujar(carlos, [operacion(carlos, 'venta.crear', v)]);
    expect(r.estado).toBe('rechazada');
    expect(r.motivo).toMatch(/precio/);
  });

  it('marca revisión si el reloj del dispositivo está desfasado', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Chile serrano', 'Única');
    const v = venta(ana, [{ clasificacionId: c.id, cantidad: '1', precio: c.precio }], { folio: ana.bloques[0].desde + 1 });
    const [r] = await empujar(ana, [operacion(ana, 'venta.crear', v)], new Date(Date.now() - 3_600_000).toISOString());
    expect(r.estado).toBe('en_revision');
    expect(r.motivo).toMatch(/hora/);
  });

  it('la bajada incremental solo trae lo que cambió después del cursor', async () => {
    const ana = await entrar('ana');
    const inicial = await bajar(ana);
    expect(inicial.cambios.productos.length).toBeGreaterThan(0);
    const vacia = await bajar(ana, inicial.cursor);
    expect(vacia.cambios.productos).toHaveLength(0);
    const c = await clasificacion(ana, 'Chile serrano', 'Única');
    await empujar(ana, [operacion(ana, 'venta.crear', venta(ana, [{ clasificacionId: c.id, cantidad: '2', precio: c.precio }]))]);
    const cambio = await bajar(ana, inicial.cursor);
    expect(cambio.cambios.ventas).toHaveLength(1);
    expect(cambio.cambios.existencias.map((e: { clasificacionId: string }) => e.clasificacionId)).toContain(c.id);
    expect(cambio.cambios.ventas[0].renglones[0].cantidad).toBe('2.000');
  });
});

describe('revisiones', () => {
  it('una venta a un cliente que aún no existe queda pendiente y se reaplica cuando llega', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Chile serrano', 'Única');
    const cliente = { id: uuid(), nombre: 'Cliente Nuevo', telefono: null, ubicacion: null, plazoDias: null, creadoEn: new Date().toISOString() };
    const v = venta(ana, [{ clasificacionId: c.id, cantidad: '1', precio: c.precio }], { clienteId: cliente.id, formaPago: 'credito', venceEl: '2030-01-01' });
    const opVenta = operacion(ana, 'venta.crear', v);
    const [r] = await empujar(ana, [opVenta]);
    expect(r.estado).toBe('en_revision');

    const pendientes = (await ana.get('/revisiones').expect(200)).body;
    const item = pendientes.find((x: { operacionId: string }) => x.operacionId === opVenta.operacion_id);
    expect(item.aplicada).toBe(false);
    // Antes de que llegue el cliente, reaplicar falla con explicación.
    await ana.post(`/revisiones/${opVenta.operacion_id}/resolver`, { accion: 'reaplicar' }).expect(409);

    expect((await empujar(ana, [operacion(ana, 'cliente.crear', cliente)]))[0].estado).toBe('aplicada');
    const resuelto = (await ana.post(`/revisiones/${opVenta.operacion_id}/resolver`, { accion: 'reaplicar', nota: 'Ya llegó el cliente' }).expect(200)).body;
    expect(resuelto.resolucion).toBe('reaplicada');
    await ana.get(`/ventas/${v.id}`).expect(200);
  });

  it('un pago con excedente se aplica, deja saldo a favor y se aprueba', async () => {
    const ana = await entrar('ana');
    const b = await bajar(ana);
    const juan = b.cambios.clientes.find((x: { nombre: string }) => x.nombre === 'Juan Pérez');
    const deuda = b.cambios.ventas.find((x: { clienteId: string; formaPago: string }) => x.clienteId === juan.id && x.formaPago === 'credito');
    const saldo = Number(deuda.total) - Number(deuda.pagado);
    const pago = { id: uuid(), clienteId: juan.id, monto: String(saldo + 100), metodo: 'efectivo', nota: null, aplicaciones: [{ ventaId: deuda.id, monto: String(saldo + 100) }] };
    const op = operacion(ana, 'pago.crear', pago);
    const [r] = await empujar(ana, [op]);
    expect(r.estado).toBe('en_revision');
    expect(r.motivo).toMatch(/Excedente/);
    const v = (await ana.get(`/ventas/${deuda.id}`).expect(200)).body;
    expect(v.estado).toBe('completada');
    await ana.post(`/revisiones/${op.operacion_id}/resolver`, { accion: 'descartar' }).expect(409);
    const ok = (await ana.post(`/revisiones/${op.operacion_id}/resolver`, { accion: 'aprobar' }).expect(200)).body;
    expect(ok.resolucion).toBe('aprobada');
  });

  it('solo quien tiene permiso puede ver y resolver revisiones', async () => {
    const carlos = await entrar('carlos');
    await carlos.get('/revisiones').expect(403);
  });
});

describe('operaciones en línea', () => {
  it('cancelar una venta regresa la mercancía al inventario', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Limón persa', 'Segunda / Mediano');
    const v = venta(ana, [{ clasificacionId: c.id, cantidad: '3', precio: c.precio }], { folio: ana.bloques[0].desde + 2 });
    await empujar(ana, [operacion(ana, 'venta.crear', v)]);
    await ana.post(`/ventas/${v.id}/cancelar`, { motivo: 'Devolución' }).expect(200);
    expect((await clasificacion(ana, 'Limón persa', 'Segunda / Mediano')).existencia).toBe(c.existencia);
    await ana.post(`/ventas/${v.id}/cancelar`, { motivo: 'Otra vez' }).expect(409);
  });

  it('el ajuste calcula la diferencia contra la existencia vigente', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Cebolla blanca', 'Primera');
    const r = await ana.post('/inventario/ajustes', { clasificacionId: c.id, cantidadContada: '7', motivo: 'Conteo físico' }).expect(200);
    expect(Number(r.body.delta)).toBe(7 - c.existencia);
    expect((await clasificacion(ana, 'Cebolla blanca', 'Primera')).existencia).toBe(7);
  });

  it('crea y archiva productos; el trabajador no puede', async () => {
    const ana = await entrar('ana');
    const carlos = await entrar('carlos');
    const unidad = (await bajar(ana)).cambios.unidades.find((u: { nombre: string }) => u.nombre === 'costal');
    const datos = { nombre: 'Papa blanca', unidadId: unidad.id, umbralBajo: '5', clasificaciones: [{ id: uuid(), nombre: 'Primera', precio: '450', existenciaInicial: '12' }] };
    await carlos.post('/productos', datos).expect(403);
    const p = (await ana.post('/productos', datos).expect(200)).body;
    expect((await clasificacion(ana, 'Papa blanca', 'Primera')).existencia).toBe(12);
    await ana.post(`/productos/${p.id}/archivar`).expect(200);
    const b = await bajar(ana);
    expect(b.cambios.productos.find((x: { id: string }) => x.id === p.id).archivadoEn).not.toBeNull();
  });

  it('un usuario suspendido ya no entra ni usa rutas en línea', async () => {
    const ana = await entrar('ana');
    const luis = await entrar('luis');
    await ana.patch(`/usuarios/${luis.usuarioId}`, { activo: false }).expect(200);
    await luis.get('/configuracion').expect(401);
    await request(app).post('/api/auth/login').send({ usuario: 'luis', contrasena: 'demo1234' }).expect(403);
    await ana.patch(`/usuarios/${luis.usuarioId}`, { activo: true }).expect(200);
  });

  it('reportes e historial responden con datos del negocio', async () => {
    const ana = await entrar('ana');
    const hoy = new Date().toISOString().slice(0, 10);
    const r = (await ana.get(`/reportes/resumen?desde=2020-01-01&hasta=${hoy}`).expect(200)).body;
    expect(r.ventas.cantidad).toBeGreaterThan(0);
    const h = (await ana.get('/historial').expect(200)).body;
    expect(h.length).toBeGreaterThan(0);
  });
});
