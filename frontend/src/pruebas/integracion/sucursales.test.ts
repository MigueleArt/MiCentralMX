import { beforeEach, describe, expect, it } from 'vitest';
import { fijarToken, usarTransporte } from '../../api/cliente';
import { crearSucursal, listarSucursales } from '../../api/sucursales';
import { cambiarSucursalSesion, cerrarSesion, iniciarSesion } from '../../auth/sesion';
import { db } from '../../db/db';
import { manejarSolicitud, reiniciarServidorDemo } from '../../demo/servidor';

usarTransporte((m, r, c, t) => manejarSolicitud(m, r, c, t));

beforeEach(async () => {
  fijarToken(null);
  await db.delete();
  await db.open();
  await reiniciarServidorDemo();
});

describe('Multi-Sucursal / Multi-Local en frontend', () => {
  it('el Dueño puede listar sucursales, crear una nueva y cambiar de sucursal', async () => {
    // 1. Iniciar sesión como Dueño (rodolfo)
    await iniciarSesion('rodolfo', 'demo1234');
    const sesionInicial = await db.leerMeta('sesion');
    expect(sesionInicial).toBeDefined();

    // 2. Listar sucursales existentes
    const lista = await listarSucursales();
    expect(Array.isArray(lista)).toBe(true);
    expect(lista.length).toBeGreaterThanOrEqual(1);

    const actual = lista.find((s) => s.esActual);
    expect(actual?.id).toBe(sesionInicial?.negocio.id);

    // 3. Crear una nueva sucursal
    const nombreNueva = `Bodega Frente ${Date.now()}`;
    const nueva = await crearSucursal({
      nombre: nombreNueva,
      ubicacion: 'Nave W Pasillo 2',
      telefono: '55 3344 5566',
    });

    expect(nueva.id).toBeDefined();
    expect(nueva.nombre).toBe(nombreNueva);

    // 4. Cambiar a la nueva sucursal
    const nuevaSesion = await cambiarSucursalSesion(nueva.id);
    expect(nuevaSesion.negocio.id).toBe(nueva.id);
    expect(nuevaSesion.negocio.nombre).toBe(nombreNueva);

    // Comprobar que en Dexie la sesión local quedó fijada con el nuevo negocio
    const metaSesion = await db.leerMeta('sesion');
    expect(metaSesion?.negocio.id).toBe(nueva.id);

    // Limpiar cerrando sesión
    await cerrarSesion();
  });
});
