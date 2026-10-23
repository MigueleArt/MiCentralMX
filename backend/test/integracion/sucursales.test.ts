import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, entrar } from '../ayuda';

const omitir = process.env.TEST_DB_OMITIR === 'true';
const suite = omitir ? describe.skip : describe;

suite('Multi-Sucursal / Multi-Local para el Dueño', () => {
  it('el Dueño puede listar sucursales, crear una nueva y cambiar de sucursal', async () => {
    // 1. Iniciar sesión como Dueño (rodolfo)
    const sDueno = await entrar('rodolfo');

    // 2. Listar sucursales iniciales
    const resInicial = await sDueno.get('/sucursales').expect(200);
    expect(Array.isArray(resInicial.body)).toBe(true);
    expect(resInicial.body.length).toBeGreaterThanOrEqual(1);

    const matriz = resInicial.body.find((b: { esActual: boolean }) => b.esActual);
    expect(matriz).toBeDefined();
    expect(matriz.id).toBe(sDueno.negocioId);

    // 3. Crear una nueva sucursal para la empresa
    const nombreNueva = `Bodega Norte ${Date.now()}`;
    const resCrear = await sDueno
      .post('/sucursales', {
        nombre: nombreNueva,
        ubicacion: 'Nave W, Bodega 45',
        telefono: '55 1234 5678',
      })
      .expect(200);

    expect(resCrear.body.id).toBeDefined();
    expect(resCrear.body.nombre).toBe(nombreNueva);
    expect(resCrear.body.esMatriz).toBe(false);

    const nuevaSucursalId = resCrear.body.id;

    // 4. Listar sucursales nuevamente: ahora debe incluir la nueva
    const resListaActualizada = await sDueno.get('/sucursales').expect(200);
    const encontrada = resListaActualizada.body.find((b: { id: string }) => b.id === nuevaSucursalId);
    expect(encontrada).toBeDefined();
    expect(encontrada.nombre).toBe(nombreNueva);

    // 5. Cambiar a la nueva sucursal
    const resCambio = await sDueno
      .post('/sucursales/cambiar', { sucursalId: nuevaSucursalId })
      .expect(200);

    expect(resCambio.body.access_token).toBeDefined();
    expect(resCambio.body.negocio.id).toBe(nuevaSucursalId);
    expect(resCambio.body.usuario.rolBase).toBe('dueno');

    // 6. Realizar peticiones con el nuevo token en la nueva sucursal
    const nuevoToken = resCambio.body.access_token;
    const resEnNueva = await request(app)
      .get('/api/sucursales')
      .set('Authorization', `Bearer ${nuevoToken}`)
      .expect(200);

    const activaEnNueva = resEnNueva.body.find((b: { id: string }) => b.id === nuevaSucursalId);
    expect(activaEnNueva.esActual).toBe(true);
  });

  it('un trabajador no puede crear sucursales (403)', async () => {
    const sTrabajador = await entrar('luis');

    await sTrabajador
      .post('/sucursales', {
        nombre: 'Sucursal no autorizada',
      })
      .expect(403);
  });
});
