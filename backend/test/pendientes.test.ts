/** Límite de intentos compartido, bajada paginada y conciliación nocturna. */
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { reiniciarLimites } from '../src/auth/rutas';
import { cerrarPools, conNegocio } from '../src/db/pool';
import { bajarPagina } from '../src/modulos/sync/bajada';
import { ejecutarNocturnas, msHasta } from '../src/tareas/nocturnas';
import { bajar, clasificacion, empujar, entrar, operacion, venta } from './ayuda';

afterAll(() => cerrarPools());
beforeEach(async () => {
  await reiniciarLimites();
});

describe('límite de intentos en la base', () => {
  it('se comparte entre instancias de la API', async () => {
    const a = crearApp();
    const b = crearApp();
    for (let i = 0; i < 3; i++) await request(a).post('/api/auth/login').send({ usuario: 'carlos', contrasena: 'mala' }).expect(401);
    for (let i = 0; i < 2; i++) await request(b).post('/api/auth/login').send({ usuario: 'carlos', contrasena: 'mala' }).expect(401);
    await request(a).post('/api/auth/login').send({ usuario: 'carlos', contrasena: 'demo1234' }).expect(429);
  });

  it('no guarda la IP ni el usuario en claro', async () => {
    await request(crearApp()).post('/api/auth/login').send({ usuario: 'carlos', contrasena: 'mala' }).expect(401);
    const c = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await c.connect();
    const { rows } = await c.query<{ clave_hash: string }>('select clave_hash from intentos_login');
    await c.end();
    expect(rows[0].clave_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('bajada paginada', () => {
  it('las páginas pequeñas traen exactamente lo mismo que una sola página', async () => {
    const ana = await entrar('ana');
    const completa = await conNegocio(ana.negocioId, (tx) => bajarPagina(tx, '0', 100_000));
    expect(completa.hayMas).toBe(false);

    const vistos: Record<string, Set<string>> = {};
    let cursor = '0';
    let paginas = 0;
    for (;;) {
      const p = await conNegocio(ana.negocioId, (tx) => bajarPagina(tx, cursor, 7));
      paginas++;
      for (const [tabla, filas] of Object.entries(p.cambios)) {
        vistos[tabla] ??= new Set();
        for (const f of filas as Array<{ id?: string; clasificacionId?: string }>) {
          const id = f.id ?? f.clasificacionId!;
          expect(vistos[tabla].has(id)).toBe(false); // sin repetidos
          vistos[tabla].add(id);
        }
      }
      cursor = p.cursor;
      if (!p.hayMas) break;
    }
    expect(paginas).toBeGreaterThan(3);
    for (const [tabla, filas] of Object.entries(completa.cambios)) expect(vistos[tabla]?.size ?? 0).toBe(filas.length);
    expect(cursor).toBe(completa.cursor);
  });

  it('un cambio a mitad de la paginación llega en la siguiente sincronización', async () => {
    const ana = await entrar('ana');
    const p1 = await conNegocio(ana.negocioId, (tx) => bajarPagina(tx, '0', 5));
    expect(p1.hayMas).toBe(true);
    const c = await clasificacion(ana, 'Chile serrano', 'Única');
    await empujar(ana, [operacion(ana, 'venta.crear', venta(ana, [{ clasificacionId: c.id, cantidad: '1', precio: c.precio }]))]);
    let cursor = p1.cursor;
    for (;;) {
      const p = await conNegocio(ana.negocioId, (tx) => bajarPagina(tx, cursor, 5));
      cursor = p.cursor;
      if (!p.hayMas) break;
    }
    const siguiente = await bajar(ana, cursor);
    expect(siguiente.cambios.existencias.map((e: { clasificacionId: string }) => e.clasificacionId)).toContain(c.id);
  });

  it('rechaza cursores mal formados', async () => {
    const ana = await entrar('ana');
    await ana.get('/sync/pull?cursor=p.1.2.99.x').expect(422);
    await ana.get("/sync/pull?cursor=1;drop").expect(422);
  });
});

describe('conciliación nocturna', () => {
  const owner = () => new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });

  it('detecta una existencia que no cuadra con su historial y la corrige', async () => {
    const ana = await entrar('ana');
    const limpio = await ejecutarNocturnas(process.env.DATABASE_PLATAFORMA_URL);
    expect(limpio.ejecutada).toBe(true);
    expect((await ana.get('/inventario/alertas').expect(200)).body).toHaveLength(0);

    // Simula una corrupción: alguien cambió la existencia sin movimiento.
    const c = await clasificacion(ana, 'Aguacate Hass', 'Segunda / Mediano');
    const db = owner();
    await db.connect();
    await db.query('update existencias set cantidad = cantidad + 5 where clasificacion_id = $1', [c.id]);
    await db.end();

    const r = await ejecutarNocturnas(process.env.DATABASE_PLATAFORMA_URL);
    expect(r.alertasAbiertas).toBe(1);
    const alertas = (await ana.get('/inventario/alertas').expect(200)).body;
    expect(alertas[0].descripcion).toBe('Aguacate Hass · Segunda / Mediano');
    expect(Number(alertas[0].existencia) - Number(alertas[0].sumaMovimientos)).toBe(5);

    const carlos = await entrar('carlos');
    await carlos.get('/inventario/alertas').expect(403);

    await ana.post(`/inventario/alertas/${alertas[0].id}/corregir`).expect(200);
    expect((await clasificacion(ana, 'Aguacate Hass', 'Segunda / Mediano')).existencia).toBe(c.existencia);
    expect((await ana.get('/inventario/alertas').expect(200)).body).toHaveLength(0);
    await ana.post(`/inventario/alertas/${alertas[0].id}/corregir`).expect(409);
  });

  it('cierra sola la alerta si alguien la arregla antes, y solo una instancia corre a la vez', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Limón persa', 'Primera / Grande');
    const db = owner();
    await db.connect();
    await db.query('update existencias set cantidad = cantidad - 2 where clasificacion_id = $1', [c.id]);
    await ana.post('/inventario/conciliar').expect(200);
    expect((await ana.get('/inventario/alertas').expect(200)).body).toHaveLength(1);
    await db.query('update existencias set cantidad = cantidad + 2 where clasificacion_id = $1', [c.id]);

    // Otra instancia tiene el candado: esta no corre.
    const otra = new pg.Client({ connectionString: process.env.DATABASE_PLATAFORMA_URL });
    await otra.connect();
    await otra.query('select pg_advisory_lock(727100001)');
    expect((await ejecutarNocturnas(process.env.DATABASE_PLATAFORMA_URL)).ejecutada).toBe(false);
    await otra.query('select pg_advisory_unlock(727100001)');
    await otra.end();

    const r = await ejecutarNocturnas(process.env.DATABASE_PLATAFORMA_URL);
    expect(r.alertasCerradas).toBe(1);
    expect((await ana.get('/inventario/alertas').expect(200)).body).toHaveLength(0);
    await db.end();
  });

  it('programa la siguiente ejecución a las 03:00 de Ciudad de México', () => {
    // 08/10/2026 23:00 en CDMX (UTC-6) → faltan 4 horas.
    expect(msHasta(3, new Date('2026-10-09T05:00:00Z'))).toBe(4 * 3_600_000);
    // 02:00 en CDMX → falta 1 hora, el mismo día.
    expect(msHasta(3, new Date('2026-10-09T08:00:00Z'))).toBe(3_600_000);
    // Justo a las 03:00 → al día siguiente.
    expect(msHasta(3, new Date('2026-10-09T09:00:00Z'))).toBe(24 * 3_600_000);
  });
});
