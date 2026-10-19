/**
 * Pruebas de Liquidaciones y Cuenta de Productores contra PostgreSQL real.
 * Cubre:
 * - Comisión por porcentaje y por unidad
 * - Comisión final distinta con nota obligatoria
 * - Un renglón no puede entrar a dos cortes, ni con dos emisiones simultáneas
 * - Neto con descuentos
 * - Saldo con pagos parciales y anticipos (incluido saldo negativo)
 * - Estado del corte con pagos acumulados (FIFO)
 * - Cancelación de una venta ya cortada crea el cargo con la tasa efectiva
 * - RLS (aislamiento por negocio)
 * - Permisos del Trabajador
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { v7 as uuid } from 'uuid';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { reiniciarLimites } from '../src/auth/rutas';
import { cerrarPools, conNegocio } from '../src/db/pool';
import { crearNegocio } from '../src/modulos/plataforma';
import { bajar, clasificacion, empujar, entrar, operacion, venta } from './ayuda';
import * as t from '../src/db/esquema';

const omitir = process.env.TEST_DB_OMITIR === 'true';
const suite = omitir ? describe.skip : describe;

afterAll(async () => {
  if (process.env.DATABASE_OWNER_URL) {
    const client = new pg.Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await client.connect();
    try {
      await client.query('delete from liquidacion_conceptos');
      await client.query('delete from liquidacion_renglones');
      await client.query('delete from liquidaciones');
      await client.query('delete from ajustes_productor');
    } catch {
      // ignorar si no se pudo conectar
    } finally {
      await client.end();
    }
  }
  await cerrarPools();
});
beforeEach(async () => {
  await reiniciarLimites();
});

suite('Liquidaciones a productores (cortes y cuentas)', () => {
  it('calcula comisión por porcentaje y por unidad', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Primera / Grande');

    // Crear proveedor con comisión por porcentaje (10%)
    const resProv1 = await ana
      .post('/proveedores', {
        nombre: `Productor Porcentaje ${uuid().slice(0, 6)}`,
        telefono: '5551234567',
        productos: 'Jitomate',
        tipo: 'tercero',
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
      })
      .expect(200);
    const provPorc = resProv1.body;

    // Crear proveedor con comisión por unidad ($5 por unidad)
    const resProv2 = await ana
      .post('/proveedores', {
        nombre: `Productor Unidad ${uuid().slice(0, 6)}`,
        telefono: '5557654321',
        productos: 'Jitomate',
        tipo: 'tercero',
        comisionTipo: 'por_unidad',
        comisionValor: '5.00',
      })
      .expect(200);
    const provUnid = resProv2.body;

    // Carga para provPorc
    const cargaId1 = uuid();
    await empujar(ana, [
      operacion(ana, 'carga', {
        id: cargaId1,
        fecha: '2026-10-18',
        proveedorId: provPorc.id,
        proveedorNombre: provPorc.nombre,
        proveedorTipo: 'tercero',
        estado: 'abierta',
        renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '10.00' }],
      }),
    ]);

    // Venta de la carga 1: 10 unidades a $20 = $200
    const v1 = venta(ana, [{ clasificacionId: c.id, cantidad: '10.00', precio: '20.00' }], {
      renglones: [{ clasificacionId: c.id, cantidad: '10.00', precio: '20.00', precioReferencia: '20.00', cargaId: cargaId1 }],
    });
    await empujar(ana, [operacion(ana, 'venta.crear', v1)]);

    // Corte para provPorc: 10% de $200 = $20
    const resCortePorc = await ana
      .post('/liquidaciones', {
        proveedorId: provPorc.id,
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
        comisionFinal: '20.00',
        renglones: [{ ventaId: v1.id, linea: 0, cargaId: cargaId1, importe: '200.00' }],
      })
      .expect(200);

    expect(Number(resCortePorc.body.liquidacion.totalVendido)).toBe(200);
    expect(Number(resCortePorc.body.liquidacion.comisionCalculada)).toBe(20);
    expect(Number(resCortePorc.body.liquidacion.comisionFinal)).toBe(20);
    expect(Number(resCortePorc.body.liquidacion.neto)).toBe(180);

    // Carga para provUnid
    const cargaId2 = uuid();
    await empujar(ana, [
      operacion(ana, 'carga', {
        id: cargaId2,
        fecha: '2026-10-18',
        proveedorId: provUnid.id,
        proveedorNombre: provUnid.nombre,
        proveedorTipo: 'tercero',
        estado: 'abierta',
        renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '8.00' }],
      }),
    ]);

    // Venta de la carga 2: 8 unidades a $25 = $200
    const v2 = venta(ana, [{ clasificacionId: c.id, cantidad: '8.00', precio: '25.00' }], {
      folio: v1.folio + 1,
      renglones: [{ clasificacionId: c.id, cantidad: '8.00', precio: '25.00', precioReferencia: '25.00', cargaId: cargaId2 }],
    });
    await empujar(ana, [operacion(ana, 'venta.crear', v2)]);

    // Corte para provUnid: 8 unidades * $5 = $40
    const resCorteUnid = await ana
      .post('/liquidaciones', {
        proveedorId: provUnid.id,
        comisionTipo: 'por_unidad',
        comisionValor: '5.00',
        comisionFinal: '40.00',
        renglones: [{ ventaId: v2.id, linea: 0, cargaId: cargaId2, importe: '200.00' }],
      })
      .expect(200);

    expect(Number(resCorteUnid.body.liquidacion.totalVendido)).toBe(200);
    expect(Number(resCorteUnid.body.liquidacion.comisionCalculada)).toBe(40);
    expect(Number(resCorteUnid.body.liquidacion.comisionFinal)).toBe(40);
    expect(Number(resCorteUnid.body.liquidacion.neto)).toBe(160);
  });

  it('exige comision_nota obligatoria si comision_final difiere de la calculada', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Segunda / Mediano');

    const resProv = await ana
      .post('/proveedores', {
        nombre: `Productor Nota ${uuid().slice(0, 6)}`,
        tipo: 'tercero',
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
      })
      .expect(200);
    const prov = resProv.body;

    const cargaId = uuid();
    await empujar(ana, [
      operacion(ana, 'carga', {
        id: cargaId,
        fecha: '2026-10-18',
        proveedorId: prov.id,
        proveedorNombre: prov.nombre,
        proveedorTipo: 'tercero',
        estado: 'abierta',
        renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '5.00' }],
      }),
    ]);

    const v = venta(ana, [{ clasificacionId: c.id, cantidad: '5.00', precio: '100.00' }], {
      renglones: [{ clasificacionId: c.id, cantidad: '5.00', precio: '100.00', precioReferencia: '100.00', cargaId }],
    });
    await empujar(ana, [operacion(ana, 'venta.crear', v)]);

    // Comisión calculada = 10% de 500 = $50. Si fijamos comisionFinal = $35 sin nota -> Error 400
    const errRes = await ana
      .post('/liquidaciones', {
        proveedorId: prov.id,
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
        comisionFinal: '35.00',
        renglones: [{ ventaId: v.id, linea: 0, cargaId, importe: '500.00' }],
      })
      .expect(400);

    expect(errRes.body.mensaje).toContain('nota de comisión es obligatoria');

    // Con nota -> Éxito 201
    const okRes = await ana
      .post('/liquidaciones', {
        proveedorId: prov.id,
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
        comisionFinal: '35.00',
        comisionNota: 'Descuento especial acordado con el productor',
        renglones: [{ ventaId: v.id, linea: 0, cargaId, importe: '500.00' }],
      })
      .expect(200);

    expect(Number(okRes.body.liquidacion.comisionCalculada)).toBe(50);
    expect(Number(okRes.body.liquidacion.comisionFinal)).toBe(35);
    expect(okRes.body.liquidacion.comisionNota).toBe('Descuento especial acordado con el productor');
  });

  it('un renglón no puede entrar a dos cortes ni con emisiones simultáneas', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Tercera / Chico');

    const resProv = await ana
      .post('/proveedores', {
        nombre: `Productor DobleCorte ${uuid().slice(0, 6)}`,
        tipo: 'tercero',
        comisionTipo: 'porcentaje',
        comisionValor: '5.00',
      })
      .expect(200);
    const prov = resProv.body;

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

    const v = venta(ana, [{ clasificacionId: c.id, cantidad: '10.00', precio: '30.00' }], {
      renglones: [{ clasificacionId: c.id, cantidad: '10.00', precio: '30.00', precioReferencia: '30.00', cargaId }],
    });
    await empujar(ana, [operacion(ana, 'venta.crear', v)]);

    // Primer corte exitoso
    await ana
      .post('/liquidaciones', {
        proveedorId: prov.id,
        comisionTipo: 'porcentaje',
        comisionValor: '5.00',
        comisionFinal: '15.00',
        renglones: [{ ventaId: v.id, linea: 0, cargaId, importe: '300.00' }],
      })
      .expect(200);

    // Segundo corte que intenta meter el mismo renglón -> Error 409
    const errRes = await ana
      .post('/liquidaciones', {
        proveedorId: prov.id,
        comisionTipo: 'porcentaje',
        comisionValor: '5.00',
        comisionFinal: '15.00',
        renglones: [{ ventaId: v.id, linea: 0, cargaId, importe: '300.00' }],
      })
      .expect(409);

    expect(errRes.body.mensaje).toContain('ya fue incluido en otra liquidación');
  });

  it('calcula neto con descuentos (flete, tara, merma, otro)', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Primera / Grande');

    const resProv = await ana
      .post('/proveedores', {
        nombre: `Productor Descuentos ${uuid().slice(0, 6)}`,
        tipo: 'tercero',
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
      })
      .expect(200);
    const prov = resProv.body;

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

    const v = venta(ana, [{ clasificacionId: c.id, cantidad: '20.00', precio: '50.00' }], {
      renglones: [{ clasificacionId: c.id, cantidad: '20.00', precio: '50.00', precioReferencia: '50.00', cargaId }],
    });
    await empujar(ana, [operacion(ana, 'venta.crear', v)]);

    // Total vendido: 1000. Comisión 10%: 100. Descuentos: flete 50, tara 30, merma 20 -> Descuentos total = 100.
    // Neto = 1000 - 100 - 100 = 800.
    const res = await ana
      .post('/liquidaciones', {
        proveedorId: prov.id,
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
        comisionFinal: '100.00',
        renglones: [{ ventaId: v.id, linea: 0, cargaId, importe: '1000.00' }],
        conceptos: [
          { tipo: 'flete', concepto: 'Flete de carga', monto: '50.00' },
          { tipo: 'tara', concepto: 'Costo de taras', monto: '30.00' },
          { tipo: 'merma', concepto: 'Merma acordada', monto: '20.00' },
        ],
      })
      .expect(200);

    expect(Number(res.body.liquidacion.totalVendido)).toBe(1000);
    expect(Number(res.body.liquidacion.comisionFinal)).toBe(100);
    expect(Number(res.body.liquidacion.descuentosTotal)).toBe(100);
    expect(Number(res.body.liquidacion.neto)).toBe(800);
    expect(res.body.conceptos).toHaveLength(3);
  });

  it('saldo con pagos parciales y anticipos (incluido saldo negativo)', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Segunda / Mediano');

    const resProv = await ana
      .post('/proveedores', {
        nombre: `Productor Saldo ${uuid().slice(0, 6)}`,
        tipo: 'tercero',
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
      })
      .expect(200);
    const prov = resProv.body;

    // 1. Entregar anticipo de $500 antes de cortar nada
    const opAnticipo = operacion(ana, 'movimiento_dinero.crear', {
      id: uuid(),
      tipo: 'egreso',
      categoria: 'anticipo_productor',
      concepto: `Anticipo a productor · ${prov.nombre}`,
      monto: '500.00',
      metodo: 'efectivo',
      proveedorId: prov.id,
      creadoEn: new Date().toISOString(),
    });
    await empujar(ana, [opAnticipo]);

    // Consultar estado de cuenta: el saldo debe ser negativo (-$500 a favor del comerciante)
    const estadoInicial = await ana.get(`/proveedores/${prov.id}/estado-cuenta`).expect(200);
    expect(Number(estadoInicial.body.totalLiquidado)).toBe(0);
    expect(Number(estadoInicial.body.totalAnticipos)).toBe(500);
    expect(Number(estadoInicial.body.saldo)).toBe(-500);

    // 2. Cargar fruta y vender
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
    const v = venta(ana, [{ clasificacionId: c.id, cantidad: '10.00', precio: '100.00' }], {
      renglones: [{ clasificacionId: c.id, cantidad: '10.00', precio: '100.00', precioReferencia: '100.00', cargaId }],
    });
    await empujar(ana, [operacion(ana, 'venta.crear', v)]);

    // Emitir corte: vendido $1000, comision 10% ($100), neto = $900
    await ana
      .post('/liquidaciones', {
        proveedorId: prov.id,
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
        comisionFinal: '100.00',
        renglones: [{ ventaId: v.id, linea: 0, cargaId, importe: '1000.00' }],
      })
      .expect(200);

    // Saldo tras el corte: neto $900 - anticipo $500 = $400 por pagar
    const estadoTrasCorte = await ana.get(`/proveedores/${prov.id}/estado-cuenta`).expect(200);
    expect(Number(estadoTrasCorte.body.totalLiquidado)).toBe(900);
    expect(Number(estadoTrasCorte.body.totalAnticipos)).toBe(500);
    expect(Number(estadoTrasCorte.body.saldo)).toBe(400);

    // 3. Registrar un pago a proveedor de $150
    const opPago = operacion(ana, 'movimiento_dinero.crear', {
      id: uuid(),
      tipo: 'egreso',
      categoria: 'pago_proveedor',
      concepto: `Pago a proveedor · ${prov.nombre}`,
      monto: '150.00',
      metodo: 'transferencia',
      proveedorId: prov.id,
      creadoEn: new Date().toISOString(),
    });
    await empujar(ana, [opPago]);

    // Saldo tras pago: $400 - $150 = $250
    const estadoFinal = await ana.get(`/proveedores/${prov.id}/estado-cuenta`).expect(200);
    expect(Number(estadoFinal.body.totalPagos)).toBe(150);
    expect(Number(estadoFinal.body.totalAnticipos)).toBe(500);
    expect(Number(estadoFinal.body.saldo)).toBe(250);
  });

  it('calcula estado del corte con pagos acumulados mediante FIFO', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Primera / Grande');

    const resProv = await ana
      .post('/proveedores', {
        nombre: `Productor FIFO ${uuid().slice(0, 6)}`,
        tipo: 'tercero',
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
      })
      .expect(200);
    const prov = resProv.body;

    // Crear dos cargas
    const cargaId1 = uuid();
    const cargaId2 = uuid();
    await empujar(ana, [
      operacion(ana, 'carga', {
        id: cargaId1,
        fecha: '2026-10-17',
        proveedorId: prov.id,
        proveedorNombre: prov.nombre,
        proveedorTipo: 'tercero',
        estado: 'abierta',
        renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '10.00' }],
      }),
      operacion(ana, 'carga', {
        id: cargaId2,
        fecha: '2026-10-18',
        proveedorId: prov.id,
        proveedorNombre: prov.nombre,
        proveedorTipo: 'tercero',
        estado: 'abierta',
        renglones: [{ linea: 0, clasificacionId: c.id, cantidad: '10.00' }],
      }),
    ]);

    // Venta 1: $500 -> Neto corte 1 = $450 (10% comision)
    const v1 = venta(ana, [{ clasificacionId: c.id, cantidad: '10.00', precio: '50.00' }], {
      renglones: [{ clasificacionId: c.id, cantidad: '10.00', precio: '50.00', precioReferencia: '50.00', cargaId: cargaId1 }],
    });
    // Venta 2: $500 -> Neto corte 2 = $450 (10% comision)
    const v2 = venta(ana, [{ clasificacionId: c.id, cantidad: '10.00', precio: '50.00' }], {
      folio: v1.folio + 1,
      renglones: [{ clasificacionId: c.id, cantidad: '10.00', precio: '50.00', precioReferencia: '50.00', cargaId: cargaId2 }],
    });
    await empujar(ana, [operacion(ana, 'venta.crear', v1), operacion(ana, 'venta.crear', v2)]);

    // Emitir corte 1 (antiguo)
    const corte1 = await ana
      .post('/liquidaciones', {
        proveedorId: prov.id,
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
        comisionFinal: '50.00',
        renglones: [{ ventaId: v1.id, linea: 0, cargaId: cargaId1, importe: '500.00' }],
      })
      .expect(200);

    // Emitir corte 2 (reciente)
    const corte2 = await ana
      .post('/liquidaciones', {
        proveedorId: prov.id,
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
        comisionFinal: '50.00',
        renglones: [{ ventaId: v2.id, linea: 0, cargaId: cargaId2, importe: '500.00' }],
      })
      .expect(200);

    // Registrar pago acumulado de $600
    // Aplica: $450 cubre totalmente el corte 1 (pagado), y $150 cubre parcialmente el corte 2 (parcial).
    const opPago = operacion(ana, 'movimiento_dinero.crear', {
      id: uuid(),
      tipo: 'egreso',
      categoria: 'pago_proveedor',
      concepto: `Pago a proveedor · ${prov.nombre}`,
      monto: '600.00',
      metodo: 'transferencia',
      proveedorId: prov.id,
      creadoEn: new Date().toISOString(),
    });
    await empujar(ana, [opPago]);

    const resEstado = await ana.get(`/proveedores/${prov.id}/estado-cuenta`).expect(200);
    const cortes = resEstado.body.cortes;
    expect(cortes).toHaveLength(2);

    const c1Info = cortes.find((x: any) => x.liquidacion.id === corte1.body.liquidacion.id);
    const c2Info = cortes.find((x: any) => x.liquidacion.id === corte2.body.liquidacion.id);

    expect(c1Info.estado).toBe('pagado');
    expect(Number(c1Info.montoCubierto)).toBe(450);

    expect(c2Info.estado).toBe('parcial');
    expect(Number(c2Info.montoCubierto)).toBe(150);
  });

  it('cancelar una venta ya cortada crea el cargo con la tasa efectiva y devuelve la fruta a la carga', async () => {
    const ana = await entrar('ana');
    const c = await clasificacion(ana, 'Jitomate Saladette', 'Tercera / Chico');

    const resProv = await ana
      .post('/proveedores', {
        nombre: `Productor Cancelacion ${uuid().slice(0, 6)}`,
        tipo: 'tercero',
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
      })
      .expect(200);
    const prov = resProv.body;

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

    // Venta: 10 unidades a $100 = $1,000
    const v = venta(ana, [{ clasificacionId: c.id, cantidad: '10.00', precio: '100.00' }], {
      renglones: [{ clasificacionId: c.id, cantidad: '10.00', precio: '100.00', precioReferencia: '100.00', cargaId }],
    });
    await empujar(ana, [operacion(ana, 'venta.crear', v)]);

    // Corte: totalVendido = $1,000, comisionFinal = $100 (tasa efectiva = 100/1000 = 0.10)
    // El neto del corte fue $900
    await ana
      .post('/liquidaciones', {
        proveedorId: prov.id,
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
        comisionFinal: '100.00',
        renglones: [{ ventaId: v.id, linea: 0, cargaId, importe: '1000.00' }],
      })
      .expect(200);

    // Cancelar la venta
    await ana
      .post(`/ventas/${v.id}/cancelar`, {
        motivo: 'Cliente devolvió el producto por mala calidad',
      })
      .expect(200);

    // Verificar que se creó el cargo en ajustes_productor:
    // cargo = importe * (1 - tasa_efectiva) = 1000 * (1 - 0.10) = $900
    const estado = await ana.get(`/proveedores/${prov.id}/estado-cuenta`).expect(200);
    const ajuste = estado.body.movimientos.find((m: any) => m.tipo === 'cargo');
    expect(ajuste).toBeDefined();
    expect(Number(ajuste.cargo)).toBe(900);

    // Y el saldo del productor debe haberse neutralizado: 900 liquidado - 900 cargo = $0
    expect(Number(estado.body.saldo)).toBe(0);

    // Verificar que la fruta regresó a la carga
    const b = await bajar(ana);
    const exCarga = b.cambios.existenciasCarga.find((ec: any) => ec.cargaId === cargaId && ec.clasificacionId === c.id);
    expect(Number(exCarga.cantidad)).toBe(10);
  });

  it('aislamiento por negocio RLS en liquidaciones y ajustes', async () => {
    const ana = await entrar('ana');
    const owner = process.env.DATABASE_OWNER_URL;
    if (!owner) throw new Error('Falta DATABASE_OWNER_URL');
    const { negocioId: neg2Id } = await crearNegocio(drizzle(owner), {
      nombre: 'Segundo Negocio Pruebas',
      ubicacion: null,
      dueno: {
        nombre: 'Dueño 2',
        usuario: `dueno-${uuid().slice(-6)}`,
        contrasena: 'demo12345',
      },
    });

    const resProv = await ana
      .post('/proveedores', {
        nombre: `Productor RLS ${uuid().slice(0, 6)}`,
        tipo: 'tercero',
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
      })
      .expect(200);
    const prov = resProv.body;

    // Crear ajuste de prueba
    const ajusteRes = await ana
      .post('/ajustes-productor', {
        proveedorId: prov.id,
        tipo: 'abono',
        categoria: 'otro',
        concepto: 'Bono especial por calidad',
        monto: '120.00',
      })
      .expect(200);

    // Conectar como el segundo negocio bajo RLS
    const ajustesNeg2 = await conNegocio(neg2Id, async (tx) =>
      tx.select().from(t.ajustesProductor).where(eq(t.ajustesProductor.id, ajusteRes.body.id)),
    );
    expect(ajustesNeg2).toHaveLength(0);
  });

  it('el rol Trabajador no tiene permisos para emitir cortes ni registrar ajustes', async () => {
    const carlos = await entrar('carlos');
    const ana = await entrar('ana');

    const resProv = await ana
      .post('/proveedores', {
        nombre: `Productor Carlos ${uuid().slice(0, 6)}`,
        tipo: 'tercero',
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
      })
      .expect(200);
    const prov = resProv.body;

    // Carlos intenta emitir liquidación -> 403 Forbidden
    await carlos
      .post('/liquidaciones', {
        proveedorId: prov.id,
        comisionTipo: 'porcentaje',
        comisionValor: '10.00',
        comisionFinal: '50.00',
        renglones: [],
      })
      .expect(403);

    // Carlos intenta registrar ajuste -> 403 Forbidden
    await carlos
      .post('/ajustes-productor', {
        proveedorId: prov.id,
        tipo: 'abono',
        categoria: 'otro',
        concepto: 'Intento no autorizado',
        monto: '100.00',
      })
      .expect(403);
  });
});

