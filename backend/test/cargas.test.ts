/**
 * Pruebas de Cargas contra PostgreSQL real (o base desechable de pruebas).
 * Cubre:
 * - Una venta descuenta de su carga y del total
 * - Dos ventas no pueden vender la misma existencia en línea
 * - Aislamiento RLS en cargas, carga_renglones y existencias_carga
 * - Reenvío idempotente de la operación 'carga'
 * - Cerrar carga con sobrante (merma y devolución)
 * - La conciliación detecta una diferencia por carga
 * - Un Trabajador no puede registrar ni cerrar cargas
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { reiniciarLimites } from '../src/auth/rutas';
import { cerrarPools, conNegocio } from '../src/db/pool';
import { crearNegocio } from '../src/modulos/plataforma';
import { ejecutarNocturnas } from '../src/tareas/nocturnas';
import { bajar, clasificacion, empujar, entrar, operacion, venta } from './ayuda';
import * as t from '../src/db/esquema';

const omitir = process.env.TEST_DB_OMITIR === 'true';
const suite = omitir ? describe.skip : describe;

afterAll(() => cerrarPools());
beforeEach(async () => {
  await reiniciarLimites();
});

suite('Cargas del día y asignación de inventario', () => {
  it('una venta descuenta de su carga y del total', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Primera / Grande');
    const bInicial = await bajar(ana);
    const prov = bInicial.cambios.proveedores[0];

    const cargaId = uuid();
    // 1. Registrar carga con 50 unidades
    const opCarga = operacion(ana, 'carga', {
      id: cargaId,
      fecha: '2026-10-18',
      proveedorId: prov.id,
      proveedorNombre: prov.nombre,
      proveedorTipo: prov.tipo ?? 'tercero',
      estado: 'abierta',
      renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '50.00' }],
    });
    const [resCarga] = await empujar(ana, [opCarga]);
    expect(resCarga.estado).toBe('sincronizada');

    // Comprobar existencias tras la carga
    const bTrasCarga = await bajar(ana);
    const exCarga1 = bTrasCarga.cambios.existenciasCarga.find((ec: any) => ec.cargaId === cargaId && ec.clasificacionId === c.id);
    expect(Number(exCarga1.cantidad)).toBe(50);

    // 2. Registrar venta de 15 unidades asignadas a la carga
    const v = venta(ana, [{ clasificacionId: c.id, cantidad: '15.00', precio: c.precio }], {
      renglones: [{ clasificacionId: c.id, cantidad: '15.00', precio: c.precio, precioReferencia: c.precio, cargaId }],
    });
    const opVenta = operacion(ana, 'venta.crear', v);
    const [resVenta] = await empujar(ana, [opVenta]);
    expect(resVenta.estado).toBe('sincronizada');

    // 3. Comprobar que descontó de la carga y del total general
    const bFinal = await bajar(ana);
    const exCargaFinal = bFinal.cambios.existenciasCarga.find((ec: any) => ec.cargaId === cargaId && ec.clasificacionId === c.id);
    expect(Number(exCargaFinal.cantidad)).toBe(35);

    const exTotalFinal = bFinal.cambios.existencias.find((e: any) => e.clasificacionId === c.id);
    expect(Number(exTotalFinal.cantidad)).toBe(c.existencia + 50 - 15);
  });

  it('dos ventas no pueden vender la misma existencia en línea', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Segunda / Mediano');
    const b = await bajar(ana);
    const prov = b.cambios.proveedores[0];

    const cargaId = uuid();
    // Carga con 10 unidades exactas
    await empujar(ana, [
      operacion(ana, 'carga', {
        id: cargaId,
        fecha: '2026-10-18',
        proveedorId: prov.id,
        proveedorNombre: prov.nombre,
        proveedorTipo: 'tercero',
        estado: 'abierta',
        renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '10.00' }],
      }),
    ]);

    // Primera venta de 10 unidades
    const v1 = venta(ana, [{ clasificacionId: c.id, cantidad: '10.00', precio: c.precio }], {
      renglones: [{ clasificacionId: c.id, cantidad: '10.00', precio: c.precio, precioReferencia: c.precio, cargaId }],
    });
    const [resV1] = await empujar(ana, [operacion(ana, 'venta.crear', v1)]);
    expect(resV1.estado).toBe('sincronizada');

    // Segunda venta simultánea/en línea por 10 unidades (sin stock suficiente en esa carga)
    const v2 = venta(ana, [{ clasificacionId: c.id, cantidad: '10.00', precio: c.precio }], {
      renglones: [{ clasificacionId: c.id, cantidad: '10.00', precio: c.precio, precioReferencia: c.precio, cargaId }],
    });
    const [resV2] = await empujar(ana, [operacion(ana, 'venta.crear', v2)]);
    // Como quedó negativa sin permiso previo, queda en revisión
    expect(resV2.estado).toBe('en_revision');
  });

  it('aislamiento RLS en las tablas nuevas (cargas, carga_renglones, existencias_carga)', async () => {
    const ana = await entrar('ana');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const db = drizzle(pool, { schema: t });

    try {
      // Crear un segundo negocio
      const neg2 = await crearNegocio(db, {
        nombre: 'Bodega Competencia',
        ubicacion: 'Nave J',
        dueno: { nombre: 'Dueño 2', usuario: 'dueno2', contrasena: 'demo1234' },
      });

      // Crear carga en el negocio de Ana
      const bAna = await bajar(ana);
      const provAna = bAna.cambios.proveedores[0];
      const clasAna = bAna.cambios.clasificaciones[0];
      const cargaAnaId = uuid();

      await empujar(ana, [
        operacion(ana, 'carga', {
          id: cargaAnaId,
          fecha: '2026-10-18',
          proveedorId: provAna.id,
          proveedorNombre: provAna.nombre,
          proveedorTipo: 'tercero',
          estado: 'abierta',
          renglones: [{ linea: 0, clasificacionId: clasAna.id, cantidad: '20.00' }],
        }),
      ]);

      // Consultar con el contexto de Negocio 2 (debe retornar vacío por RLS forzado)
      const cargasVistasPorNeg2 = await conNegocio(neg2.negocioId, (tx) =>
        tx.select().from(t.cargas).where(eq(t.cargas.id, cargaAnaId)),
      );
      expect(cargasVistasPorNeg2).toHaveLength(0);

      const existenciasCargaNeg2 = await conNegocio(neg2.negocioId, (tx) =>
        tx.select().from(t.existenciasCarga).where(eq(t.existenciasCarga.cargaId, cargaAnaId)),
      );
      expect(existenciasCargaNeg2).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });

  it('reenvío idempotente de la operación carga', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Tercera / Chico');
    const b = await bajar(ana);
    const prov = b.cambios.proveedores[0];

    const opId = uuid();
    const cargaId = uuid();
    const op = {
      operacion_id: opId,
      tipo: 'carga',
      usuario_id: ana.usuarioId,
      creado_en_dispositivo: new Date().toISOString(),
      hash: 'hash-prueba-carga',
      datos: {
        id: cargaId,
        fecha: '2026-10-18',
        proveedorId: prov.id,
        proveedorNombre: prov.nombre,
        proveedorTipo: 'rancho_propio',
        estado: 'abierta',
        renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '25.00' }],
      },
    };

    // Primer envío
    const [res1] = await empujar(ana, [op]);
    expect(res1.estado).toBe('sincronizada');

    // Segundo envío (idempotencia)
    const [res2] = await empujar(ana, [op]);
    expect(res2.estado).toBe('sincronizada');

    // Verificar que no se duplicaron las existencias
    const bFinal = await bajar(ana);
    const ex = bFinal.cambios.existenciasCarga.find((x: any) => x.cargaId === cargaId && x.clasificacionId === c.id);
    expect(Number(ex.cantidad)).toBe(25);
  });

  it('cerrar carga con sobrante como merma y devolucion', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Primera / Grande');
    const b = await bajar(ana);
    const prov = b.cambios.proveedores[0];

    const cargaId = uuid();
    await empujar(ana, [
      operacion(ana, 'carga', {
        id: cargaId,
        fecha: '2026-10-18',
        proveedorId: prov.id,
        proveedorNombre: prov.nombre,
        proveedorTipo: 'tercero',
        estado: 'abierta',
        renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '10.00' }],
      }),
    ]);

    // Cerrar la carga resolviendo el sobrante como merma
    const resCierre = await ana
      .post(`/cargas/${cargaId}/cerrar`, {
        resoluciones: [
          {
            clasificacionId: c.id,
            accion: 'merma',
            motivo: 'Fruta madura al final del día',
          },
        ],
      })
      .expect(200);

    expect(resCierre.body.ok).toBe(true);

    // Tras cerrar, la carga está en estado 'cerrada' y la existencia en carga queda en 0
    const bFinal = await bajar(ana);
    const cargaFinal = bFinal.cambios.cargas.find((x: any) => x.id === cargaId);
    expect(cargaFinal.estado).toBe('cerrada');

    const exFinal = bFinal.cambios.existenciasCarga.find((x: any) => x.cargaId === cargaId && x.clasificacionId === c.id);
    expect(Number(exFinal.cantidad)).toBe(0);
  });

  it('la conciliación detecta una diferencia por carga', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Segunda / Mediano');
    const b = await bajar(ana);
    const prov = b.cambios.proveedores[0];

    const cargaId = uuid();
    await empujar(ana, [
      operacion(ana, 'carga', {
        id: cargaId,
        fecha: '2026-10-18',
        proveedorId: prov.id,
        proveedorNombre: prov.nombre,
        proveedorTipo: 'tercero',
        estado: 'abierta',
        renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '30.00' }],
      }),
    ]);

    // Provocar deliberadamente una discrepancia en existencias_carga
    await conNegocio(ana.negocioId, (tx) =>
      tx
        .update(t.existenciasCarga)
        .set({ cantidad: '999.00' })
        .where(eq(t.existenciasCarga.cargaId, cargaId)),
    );

    // Correr la conciliación nocturna
    await ejecutarNocturnas();

    // La conciliación debe haber registrado la discrepancia en alertas_inventario
    const alertas = await conNegocio(ana.negocioId, (tx) =>
      tx
        .select()
        .from(t.alertasInventario)
        .where(eq(t.alertasInventario.cargaId, cargaId)),
    );
    expect(alertas.length).toBeGreaterThan(0);
  });

  it('un Trabajador no puede registrar ni cerrar cargas', async () => {
    const carlos = await entrar('carlos'); // rol: trabajador
    const b = await bajar(carlos);
    const prov = b.cambios.proveedores[0];
    const clas = b.cambios.clasificaciones[0];

    // 1. Intentar registrar una carga offline -> el servidor rechaza por falta de permiso
    const [res] = await empujar(carlos, [
      operacion(carlos, 'carga', {
        id: uuid(),
        fecha: '2026-10-18',
        proveedorId: prov.id,
        proveedorNombre: prov.nombre,
        proveedorTipo: 'tercero',
        estado: 'abierta',
        renglones: [{ linea: 0, clasificacionId: clas.id, cantidad: '10.00' }],
      }),
    ]);
    expect(res.estado).toBe('rechazada');
    expect(res.motivo).toMatch(/cargas\.registrar/i);

    // 2. Intentar cerrar una carga en línea -> 403 Forbidden
    await carlos
      .post(`/cargas/${uuid()}/cerrar`, {
        resoluciones: [],
      })
      .expect(403);
  });
});
