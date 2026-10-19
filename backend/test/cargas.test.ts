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
import { and, eq } from 'drizzle-orm';
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
    expect(resCarga.estado).toBe('aplicada');

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
    expect(resVenta.estado).toBe('aplicada');

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
    expect(resV1.estado).toBe('aplicada');

    // Segunda venta simultánea/en línea por 10 unidades (sin stock suficiente en esa carga)
    const v2 = venta(ana, [{ clasificacionId: c.id, cantidad: '10.00', precio: c.precio }], {
      folio: v1.folio + 1,
      renglones: [{ clasificacionId: c.id, cantidad: '10.00', precio: c.precio, precioReferencia: c.precio, cargaId }],
    });
    const [resV2] = await empujar(ana, [operacion(ana, 'venta.crear', v2)]);
    // Como quedó negativa sin permiso previo, queda en revisión
    expect(resV2.estado).toBe('en_revision');
  });

  it('aislamiento RLS en las tablas nuevas (cargas, carga_renglones, existencias_carga)', async () => {
    const ana = await entrar('ana');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_PLATAFORMA_URL ?? process.env.DATABASE_OWNER_URL });
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
    expect(res1.estado).toBe('aplicada');

    // Segundo envío (idempotencia)
    const [res2] = await empujar(ana, [op]);
    expect(res2.estado).toBe('duplicada');

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

    // Restaurar existencia para no contaminar pruebas posteriores
    const clientDiscrepancia = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await clientDiscrepancia.connect();
    await clientDiscrepancia.query('update existencias_carga set cantidad = 30 where carga_id = $1', [cargaId]);
    await clientDiscrepancia.query('delete from alertas_inventario');
    await clientDiscrepancia.end();
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
    expect(res.motivo).toMatch(/permiso para registrar cargas/i);

    // 2. Intentar cerrar una carga en línea -> 403 Forbidden
    await carlos
      .post(`/cargas/${uuid()}/cerrar`, {
        resoluciones: [],
      })
      .expect(403);
  });

  it('vender de una carga, cancelar y comprobar que la carga recupera la cantidad y existencias cuadran', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Primera / Grande');
    const bInicial = await bajar(ana);
    const prov = bInicial.cambios.proveedores[0];
    const exInicialTotal = Number(bInicial.cambios.existencias.find((e: any) => e.clasificacionId === c.id)?.cantidad ?? 0);

    const cargaId = uuid();
    // 1. Carga con 40 unidades
    await empujar(ana, [
      operacion(ana, 'carga', {
        id: cargaId,
        fecha: '2026-10-18',
        proveedorId: prov.id,
        proveedorNombre: prov.nombre,
        proveedorTipo: 'tercero',
        estado: 'abierta',
        renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '40.00' }],
      }),
    ]);

    // 2. Vender 15 unidades de esa carga
    const vId = uuid();
    const v = venta(ana, [{ clasificacionId: c.id, cantidad: '15.00', precio: c.precio }], {
      id: vId,
      renglones: [{ clasificacionId: c.id, cantidad: '15.00', precio: c.precio, precioReferencia: c.precio, cargaId }],
    });
    await empujar(ana, [operacion(ana, 'venta.crear', v)]);

    // Comprobar existencias tras venta
    let b = await bajar(ana);
    let exCarga = Number(b.cambios.existenciasCarga.find((ec: any) => ec.cargaId === cargaId && ec.clasificacionId === c.id).cantidad);
    let exTotal = Number(b.cambios.existencias.find((e: any) => e.clasificacionId === c.id).cantidad);
    expect(exCarga).toBe(25);
    expect(exTotal).toBe(exInicialTotal + 40 - 15);

    // 3. Cancelar la venta en línea
    await ana.post(`/ventas/${vId}/cancelar`, { motivo: 'Cliente canceló pedido' }).expect(200);

    // 4. Comprobar que la carga recuperó la cantidad (40) y el total se restableció
    b = await bajar(ana);
    exCarga = Number(b.cambios.existenciasCarga.find((ec: any) => ec.cargaId === cargaId && ec.clasificacionId === c.id).cantidad);
    exTotal = Number(b.cambios.existencias.find((e: any) => e.clasificacionId === c.id).cantidad);
    expect(exCarga).toBe(40);
    expect(exTotal).toBe(exInicialTotal + 40);

    // 5. Vender de nuevo 15 unidades de esa carga con una nueva venta
    const vId2 = uuid();
    const v2 = venta(ana, [{ clasificacionId: c.id, cantidad: '15.00', precio: c.precio }], {
      id: vId2,
      folio: v.folio + 1,
      renglones: [{ clasificacionId: c.id, cantidad: '15.00', precio: c.precio, precioReferencia: c.precio, cargaId }],
    });
    await empujar(ana, [operacion(ana, 'venta.crear', v2)]);

    // 6. Cerrar la carga (sobrante de 25 como devolución)
    await ana.post(`/cargas/${cargaId}/cerrar`, { resoluciones: [{ clasificacionId: c.id, accion: 'devolucion' }] }).expect(200);
    let bCerrada = await bajar(ana);
    let cg = bCerrada.cambios.cargas.find((cr: any) => cr.id === cargaId);
    expect(cg.estado).toBe('cerrada');

    // 7. Cancelar la venta vId2: como la carga está cerrada pero no tiene ventas liquidadas, debe reabrirla
    // y devolver la fruta (15 unidades) a la carga y a existencias_carga.
    await ana.post(`/ventas/${vId2}/cancelar`, { motivo: 'Cliente canceló pedido' }).expect(200);

    b = await bajar(ana);
    cg = b.cambios.cargas.find((cr: any) => cr.id === cargaId);
    expect(cg.estado).toBe('abierta'); // Se reabrió!

    exCarga = Number(b.cambios.existenciasCarga.find((ec: any) => ec.cargaId === cargaId && ec.clasificacionId === c.id).cantidad);
    expect(exCarga).toBe(15); // Recuperó las 15 unidades de la venta cancelada
    exTotal = Number(b.cambios.existencias.find((e: any) => e.clasificacionId === c.id).cantidad);
    expect(exTotal).toBe(exInicialTotal + 40 - 25);
  });

  it('merma descuenta de la carga y del total; merma sin carga descuenta del total general', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Primera / Grande');
    const bInicial = await bajar(ana);
    const prov = bInicial.cambios.proveedores[0];
    const exInicialTotal = Number(bInicial.cambios.existencias.find((e: any) => e.clasificacionId === c.id)?.cantidad ?? 0);

    const cargaId = uuid();
    await empujar(ana, [
      operacion(ana, 'carga', {
        id: cargaId,
        fecha: '2026-10-18',
        proveedorId: prov.id,
        proveedorNombre: prov.nombre,
        proveedorTipo: 'tercero',
        estado: 'abierta',
        renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '20.00' }],
      }),
    ]);

    // Merma de 4 unidades asignada a la carga
    const mermaCargaId = uuid();
    await empujar(ana, [
      operacion(ana, 'merma.crear', {
        id: mermaCargaId,
        clasificacionId: c.id,
        cantidad: '4.00',
        motivo: 'Maduro / daño en transporte',
        nota: null,
        cargaId,
      }),
    ]);

    let b = await bajar(ana);
    let exCarga = Number(b.cambios.existenciasCarga.find((ec: any) => ec.cargaId === cargaId && ec.clasificacionId === c.id).cantidad);
    let exTotal = Number(b.cambios.existencias.find((e: any) => e.clasificacionId === c.id).cantidad);
    expect(exCarga).toBe(16);
    expect(exTotal).toBe(exInicialTotal + 20 - 4);

    // Merma sin carga (merma general): no debe tocar existencias_carga
    const mermaGeneralId = uuid();
    await empujar(ana, [
      operacion(ana, 'merma.crear', {
        id: mermaGeneralId,
        clasificacionId: c.id,
        cantidad: '2.00',
        motivo: 'Pudrición en piso',
        nota: null,
      }),
    ]);

    b = await bajar(ana);
    exCarga = Number(b.cambios.existenciasCarga.find((ec: any) => ec.cargaId === cargaId && ec.clasificacionId === c.id).cantidad);
    exTotal = Number(b.cambios.existencias.find((e: any) => e.clasificacionId === c.id).cantidad);
    expect(exCarga).toBe(16); // La carga sigue en 16
    expect(exTotal).toBe(exInicialTotal + 20 - 4 - 2);
    // Existencia general derivada: exTotal - sum(exCarga) >= 0 (no negativa)
    expect(exTotal).toBeGreaterThanOrEqual(exCarga);
  });

  it('venta sincronizada conserva origen_nombre y llega a otro dispositivo', async () => {
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

    const vId = uuid();
    const v = venta(ana, [{ clasificacionId: c.id, cantidad: '5.00', precio: c.precio }], {
      id: vId,
      renglones: [
        {
          clasificacionId: c.id,
          cantidad: '5.00',
          precio: c.precio,
          precioReferencia: c.precio,
          cargaId,
          origenNombre: prov.nombre,
        },
      ],
    });
    await empujar(ana, [operacion(ana, 'venta.crear', v)]);

    // Otro dispositivo (Carlos) hace un pull completo desde cursor inicial 0
    const carlos = await entrar('carlos');
    const bCarlos = await bajar(carlos, '0');
    const ventaCarlos = bCarlos.cambios.ventas.find((vt: any) => vt.id === vId);
    expect(ventaCarlos).toBeDefined();
    expect(ventaCarlos.renglones[0].origenNombre).toBe(prov.nombre);
  });

  it('conciliación nocturna detecta cuando sum(existencias_carga) > existencias.cantidad', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Tercera / Chico');
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
        renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '25.00' }],
      }),
    ]);

    // Forzar que existencias.cantidad sea menor a las existencias_carga (ej. 10 < 25)
    await conNegocio(ana.negocioId, (tx) =>
      tx
        .update(t.existencias)
        .set({ cantidad: '10.00' })
        .where(eq(t.existencias.clasificacionId, c.id)),
    );

    // Correr conciliación nocturna
    await ejecutarNocturnas();

    // Debe existir alerta con tipo 'carga_excede_total'
    const alertas = await conNegocio(ana.negocioId, (tx) =>
      tx
        .select()
        .from(t.alertasInventario)
        .where(and(eq(t.alertasInventario.clasificacionId, c.id), eq(t.alertasInventario.tipo, 'carga_excede_total'))),
    );
    expect(alertas.length).toBeGreaterThan(0);
    expect(Number(alertas[0].existencia)).toBe(10);
    expect(Number(alertas[0].sumaMovimientos)).toBeGreaterThan(Number(alertas[0].existencia));

    // Corregir existencia para que sea >= cargas
    await conNegocio(ana.negocioId, (tx) =>
      tx
        .update(t.existencias)
        .set({ cantidad: alertas[0].sumaMovimientos })
        .where(eq(t.existencias.clasificacionId, c.id)),
    );
    await ejecutarNocturnas();

    const alertasResueltas = await conNegocio(ana.negocioId, (tx) =>
      tx
        .select()
        .from(t.alertasInventario)
        .where(and(eq(t.alertasInventario.id, alertas[0].id))),
    );
    expect(alertasResueltas[0].resolucion).toBe('coincide');
    expect(alertasResueltas[0].resueltaEn).not.toBeNull();

    // Restaurar existencias y limpiar datos de prueba para no contaminar
    const clientNocturnas = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await clientNocturnas.connect();
    await clientNocturnas.query('update existencias set cantidad = $1 where clasificacion_id = $2', [c.existencia.toString(), c.id]);
    await clientNocturnas.query('delete from alertas_inventario');
    await clientNocturnas.query('delete from movimientos_inventario where carga_id = $1', [cargaId]);
    await clientNocturnas.query('delete from existencias_carga where carga_id = $1', [cargaId]);
    await clientNocturnas.query('delete from carga_renglones where carga_id = $1', [cargaId]);
    await clientNocturnas.query('delete from cargas where id = $1', [cargaId]);
    await clientNocturnas.end();
  });

  afterAll(async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await client.connect();
    // 1. Eliminar alertas
    await client.query('delete from alertas_inventario');
    // 2. Limpiar cargas de prueba que no sean de Rodolfo (semilla)
    const res = await client.query("select id from cargas where usuario_nombre <> 'Rodolfo Hernández'");
    const testCargaIds: string[] = res.rows.map((r) => r.id);
    if (testCargaIds.length > 0) {
      await client.query('delete from liquidacion_renglones where carga_id = any($1)', [testCargaIds]);
      await client.query('update venta_renglones set carga_id = null where carga_id = any($1)', [testCargaIds]);
      await client.query('delete from existencias_carga where carga_id = any($1)', [testCargaIds]);
      await client.query('delete from carga_renglones where carga_id = any($1)', [testCargaIds]);
      await client.query('delete from movimientos_inventario where carga_id = any($1)', [testCargaIds]);
      await client.query('delete from cargas where id = any($1)', [testCargaIds]);
    }
    // 3. Restaurar existencias para que cuadren con la suma de movimientos
    await client.query(`
      update existencias e
      set cantidad = coalesce((select sum(delta) from movimientos_inventario m where m.clasificacion_id = e.clasificacion_id), 0)
    `);
    // 4. Si la suma de existencias_carga aún supera la existencia, ajustar existencias_carga al total
    await client.query(`
      delete from existencias_carga ec
      where ec.carga_id not in (select id from cargas where usuario_nombre = 'Rodolfo Hernández')
    `);
    await client.query('delete from alertas_inventario');
    await client.end();
  });
});

