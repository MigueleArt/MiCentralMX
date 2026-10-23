import { beforeEach, describe, expect, it } from 'vitest';
import { fijarToken, usarTransporte } from '../../api/cliente';
import { iniciarSesion } from '../../auth/sesion';
import { db } from '../../db/db';
import { asignarCargaRenglon, catalogo, existenciasCargaEfectivas } from '../../dominio/consultas';
import { registrarCarga, registrarVenta, registrarMerma } from '../../dominio/operaciones';
import { manejarSolicitud, reiniciarServidorDemo } from '../../demo/servidor';
import { sincronizar } from '../../sync/motor';
import { nuevoId } from '../../lib/ids';


usarTransporte((m, r, c, t) => manejarSolicitud(m, r, c, t));

async function entrar(usuario = 'ana') {
  await iniciarSesion(usuario, 'demo1234');
  await sincronizar();
}

async function obtenerClasificacion(producto = 'Jitomate Saladette', nombre = 'Primera / Grande') {
  const p = (await catalogo()).find((x) => x.producto.nombre === producto)!;
  return p.clasificaciones.find((c) => c.clasificacion.nombre === nombre)!;
}

beforeEach(async () => {
  fijarToken(null);
  await db.delete();
  await db.open();
  await reiniciarServidorDemo();
});

describe('cargas y asignación en frontend', () => {
  it('venta sin conexión asignada a la carga más antigua', async () => {
    await entrar('ana');
    const clas = await obtenerClasificacion();
    const proveedores = await db.proveedores.toArray();
    const prov = proveedores[0];

    // Limpiar cargas existentes y movimientos para prueba aislada
    await db.cargas.clear();
    await db.existenciasCarga.clear();
    await db.movimientosInventario.clear();

    const cargaAntiguaId = nuevoId();
    const cargaNuevaId = nuevoId();

    // Carga 1: Ayer (más antigua) con 10 unidades
    await db.cargas.put({
      id: cargaAntiguaId,
      fecha: '2026-10-17',
      proveedorId: prov.id,
      estado: 'abierta',
      usuarioId: 'u1',
      usuarioNombre: 'Ana',
      dispositivoId: 'd1',
      creadoEnDispositivo: '2026-10-17T08:00:00Z',
      cerradaEn: null,
      renglones: [{ cargaId: cargaAntiguaId, linea: 1, clasificacionId: clas.clasificacion.id, cantidad: '10' }],
    });
    await db.existenciasCarga.put({
      id: nuevoId(),
      cargaId: cargaAntiguaId,
      clasificacionId: clas.clasificacion.id,
      cantidad: '10',
    });

    // Carga 2: Hoy (más nueva) con 20 unidades
    await db.cargas.put({
      id: cargaNuevaId,
      fecha: '2026-10-18',
      proveedorId: prov.id,
      estado: 'abierta',
      usuarioId: 'u1',
      usuarioNombre: 'Ana',
      dispositivoId: 'd1',
      creadoEnDispositivo: '2026-10-18T08:00:00Z',
      cerradaEn: null,
      renglones: [{ cargaId: cargaNuevaId, linea: 1, clasificacionId: clas.clasificacion.id, cantidad: '20' }],
    });
    await db.existenciasCarga.put({
      id: nuevoId(),
      cargaId: cargaNuevaId,
      clasificacionId: clas.clasificacion.id,
      cantidad: '20',
    });

    // Venta sin conexión por 4 unidades
    const asignados = await asignarCargaRenglon(clas.clasificacion.id, '4');
    expect(asignados).toHaveLength(1);
    expect(asignados[0].cargaId).toBe(cargaAntiguaId);
    expect(asignados[0].cantidad).toBe('4');

    const venta = await registrarVenta({
      clienteId: null,
      formaPago: 'efectivo',
      venceEl: null,
      enLinea: false,
      motivoSinExistencia: null,
      renglones: asignados.map((r) => ({
        clasificacionId: clas.clasificacion.id,
        cantidad: r.cantidad,
        precio: clas.clasificacion.precio,
        cargaId: r.cargaId,
        origenNombre: r.origenNombre,
      })),
    });

    expect(venta.renglones).toHaveLength(1);
    expect(venta.renglones[0].cargaId).toBe(cargaAntiguaId);
    expect(venta.renglones[0].cantidad).toBe('4');
  });

  it('división de renglón entre dos cargas cuando la cantidad supera la existencia de la primera', async () => {
    await entrar('ana');
    const clas = await obtenerClasificacion();
    const proveedores = await db.proveedores.toArray();
    const prov = proveedores[0];

    await db.cargas.clear();
    await db.existenciasCarga.clear();
    await db.movimientosInventario.clear();

    const carga1Id = nuevoId();
    const carga2Id = nuevoId();

    // Carga 1: 10 unidades
    await db.cargas.put({
      id: carga1Id,
      fecha: '2026-10-17',
      proveedorId: prov.id,
      estado: 'abierta',
      usuarioId: 'u1',
      usuarioNombre: 'Ana',
      dispositivoId: 'd1',
      creadoEnDispositivo: '2026-10-17T08:00:00Z',
      cerradaEn: null,
      renglones: [{ cargaId: carga1Id, linea: 1, clasificacionId: clas.clasificacion.id, cantidad: '10' }],
    });
    await db.existenciasCarga.put({
      id: nuevoId(),
      cargaId: carga1Id,
      clasificacionId: clas.clasificacion.id,
      cantidad: '10',
    });

    // Carga 2: 20 unidades
    await db.cargas.put({
      id: carga2Id,
      fecha: '2026-10-18',
      proveedorId: prov.id,
      estado: 'abierta',
      usuarioId: 'u1',
      usuarioNombre: 'Ana',
      dispositivoId: 'd1',
      creadoEnDispositivo: '2026-10-18T08:00:00Z',
      cerradaEn: null,
      renglones: [{ cargaId: carga2Id, linea: 1, clasificacionId: clas.clasificacion.id, cantidad: '20' }],
    });
    await db.existenciasCarga.put({
      id: nuevoId(),
      cargaId: carga2Id,
      clasificacionId: clas.clasificacion.id,
      cantidad: '20',
    });

    // Se venden 15 unidades: debe tomar 10 de Carga 1 y 5 de Carga 2
    const asignados = await asignarCargaRenglon(clas.clasificacion.id, '15');
    expect(asignados).toHaveLength(2);
    expect(asignados[0].cargaId).toBe(carga1Id);
    expect(asignados[0].cantidad).toBe('10');
    expect(asignados[1].cargaId).toBe(carga2Id);
    expect(asignados[1].cantidad).toBe('5');

    const venta = await registrarVenta({
      clienteId: null,
      formaPago: 'efectivo',
      venceEl: null,
      enLinea: false,
      motivoSinExistencia: null,
      renglones: asignados.map((r) => ({
        clasificacionId: clas.clasificacion.id,
        cantidad: r.cantidad,
        precio: clas.clasificacion.precio,
        cargaId: r.cargaId,
        origenNombre: r.origenNombre,
      })),
    });

    expect(venta.renglones).toHaveLength(2);
    expect(venta.renglones[0].cargaId).toBe(carga1Id);
    expect(venta.renglones[1].cargaId).toBe(carga2Id);
  });

  it('existencia efectiva con operaciones pendientes', async () => {
    await entrar('ana');
    const clas = await obtenerClasificacion();
    const proveedores = await db.proveedores.toArray();
    const prov = proveedores[0];

    await db.cargas.clear();
    await db.existenciasCarga.clear();
    await db.movimientosInventario.clear();

    const cargaId = nuevoId();
    await db.cargas.put({
      id: cargaId,
      fecha: '2026-10-18',
      proveedorId: prov.id,
      estado: 'abierta',
      usuarioId: 'u1',
      usuarioNombre: 'Ana',
      dispositivoId: 'd1',
      creadoEnDispositivo: '2026-10-18T08:00:00Z',
      cerradaEn: null,
      renglones: [{ cargaId, linea: 1, clasificacionId: clas.clasificacion.id, cantidad: '25' }],
    });
    await db.existenciasCarga.put({
      id: nuevoId(),
      cargaId,
      clasificacionId: clas.clasificacion.id,
      cantidad: '25',
    });

    // Antes de vender: existencia efectiva = 25
    let existencias = await existenciasCargaEfectivas();
    expect(existencias.get(`${cargaId}:${clas.clasificacion.id}`)?.toString()).toBe('25');

    // Registrar venta pendiente de 7 unidades
    await registrarVenta({
      clienteId: null,
      formaPago: 'efectivo',
      venceEl: null,
      enLinea: false,
      motivoSinExistencia: null,
      renglones: [
        {
          clasificacionId: clas.clasificacion.id,
          cantidad: '7',
          precio: clas.clasificacion.precio,
          cargaId,
        },
      ],
    });

    // Después de vender (offline/pendiente): existencia efectiva en carga = 18
    existencias = await existenciasCargaEfectivas();
    expect(existencias.get(`${cargaId}:${clas.clasificacion.id}`)?.toString()).toBe('18');

    // Registrar una carga offline nueva
    const nuevaCarga = await registrarCarga({
      fecha: '2026-10-18',
      proveedorId: prov.id,
      renglones: [{ clasificacionId: clas.clasificacion.id, cantidad: '12' }],
    });

    existencias = await existenciasCargaEfectivas();
    expect(existencias.get(`${nuevaCarga.id}:${clas.clasificacion.id}`)?.toString()).toBe('12');
  });

  it('fracciones de tara aceptadas', async () => {
    await entrar('ana');
    const clas = await obtenerClasificacion();
    const proveedores = await db.proveedores.toArray();
    const prov = proveedores[0];

    await db.cargas.clear();
    await db.existenciasCarga.clear();
    await db.movimientosInventario.clear();

    const cargaId = nuevoId();
    await db.cargas.put({
      id: cargaId,
      fecha: '2026-10-18',
      proveedorId: prov.id,
      estado: 'abierta',
      usuarioId: 'u1',
      usuarioNombre: 'Ana',
      dispositivoId: 'd1',
      creadoEnDispositivo: '2026-10-18T08:00:00Z',
      cerradaEn: null,
      renglones: [{ cargaId, linea: 1, clasificacionId: clas.clasificacion.id, cantidad: '50' }],
    });
    await db.existenciasCarga.put({
      id: nuevoId(),
      cargaId,
      clasificacionId: clas.clasificacion.id,
      cantidad: '50',
    });

    // Venta con 2.5 taras
    const venta = await registrarVenta({
      clienteId: null,
      formaPago: 'efectivo',
      venceEl: null,
      enLinea: false,
      motivoSinExistencia: null,
      renglones: [
        {
          clasificacionId: clas.clasificacion.id,
          cantidad: '2.5',
          precio: clas.clasificacion.precio,
          cargaId,
        },
      ],
    });

    expect(venta.renglones[0].cantidad).toBe('2.5');
    const existencias = await existenciasCargaEfectivas();
    expect(existencias.get(`${cargaId}:${clas.clasificacion.id}`)?.toString()).toBe('47.5');
  });

  it('merma resta de existenciasCargaEfectivas y por omisión toma la carga más antigua con existencia', async () => {
    await entrar('ana');
    const clas = await obtenerClasificacion('Jitomate Saladette', 'Primera / Grande');
    const provs = await db.proveedores.toArray();

    // 1. Carga más antigua (fecha ayer)
    const cargaAntiguaId = nuevoId();
    await db.cargas.put({
      id: cargaAntiguaId,
      fecha: '2026-10-17',
      proveedorId: provs[0].id,
      estado: 'abierta',
      renglones: [{ linea: 0, clasificacionId: clas.clasificacion.id, cantidad: '30' }],
      usuarioId: nuevoId(),
      usuarioNombre: 'Ana',
      dispositivoId: 'demo',
      creadoEnDispositivo: '2026-10-17T10:00:00.000Z',
      cerradaEn: null,
    });
    await db.existenciasCarga.put({
      id: nuevoId(),
      cargaId: cargaAntiguaId,
      clasificacionId: clas.clasificacion.id,
      cantidad: '30',
    });

    // 2. Carga más reciente (fecha hoy)
    const cargaRecienteId = nuevoId();
    await db.cargas.put({
      id: cargaRecienteId,
      fecha: '2026-10-18',
      proveedorId: provs[0].id,
      estado: 'abierta',
      renglones: [{ linea: 0, clasificacionId: clas.clasificacion.id, cantidad: '20' }],
      usuarioId: nuevoId(),
      usuarioNombre: 'Ana',
      dispositivoId: 'demo',
      creadoEnDispositivo: '2026-10-18T10:00:00.000Z',
      cerradaEn: null,
    });
    await db.existenciasCarga.put({
      id: nuevoId(),
      cargaId: cargaRecienteId,
      clasificacionId: clas.clasificacion.id,
      cantidad: '20',
    });

    // Registrar merma sin pasar cargaId -> debe tomar la más antigua (cargaAntiguaId)
    const merma = await registrarMerma({
      clasificacionId: clas.clasificacion.id,
      cantidad: '5',
      motivo: 'Maduro / daño',
      nota: null,
    });
    expect(merma.cargaId).toBe(cargaAntiguaId);

    // existenciasCargaEfectivas debe haber restado los 5 de cargaAntiguaId
    let existencias = await existenciasCargaEfectivas();
    expect(existencias.get(`${cargaAntiguaId}:${clas.clasificacion.id}`)?.toString()).toBe('25');
    expect(existencias.get(`${cargaRecienteId}:${clas.clasificacion.id}`)?.toString()).toBe('20');

    // Registrar merma explícita sobre cargaRecienteId
    await registrarMerma({
      clasificacionId: clas.clasificacion.id,
      cantidad: '3',
      motivo: 'Pudrición',
      nota: null,
      cargaId: cargaRecienteId,
    });
    existencias = await existenciasCargaEfectivas();
    expect(existencias.get(`${cargaRecienteId}:${clas.clasificacion.id}`)?.toString()).toBe('17');
  });
});
