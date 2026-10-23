import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { app } from '../ayuda';

const omitir = process.env.TEST_DB_OMITIR === 'true';
const suite = omitir ? describe.skip : describe;

suite('Panel de Plataforma (SuperAdmin)', () => {
  const token = config.plataformaToken ?? 'cambiar-token-de-plataforma';

  it('rechaza solicitudes sin token o con token inválido', async () => {
    await request(app)
      .get('/api/plataforma/negocios')
      .expect(401);

    await request(app)
      .get('/api/plataforma/negocios')
      .set('x-plataforma-token', 'token-invalido-123')
      .expect(401);
  });

  it('verifica credenciales de superadmin con éxito', async () => {
    const res = await request(app)
      .post('/api/plataforma/auth/verificar')
      .send({ token })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.mensaje).toContain('Superadministrador');
  });

  it('lista todos los negocios registrados con métricas agregadas', async () => {
    const res = await request(app)
      .get('/api/plataforma/negocios')
      .set('x-plataforma-token', token)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const primerNegocio = res.body[0];
    expect(primerNegocio).toHaveProperty('id');
    expect(primerNegocio).toHaveProperty('nombre');
    expect(primerNegocio).toHaveProperty('totalUsuarios');
    expect(primerNegocio).toHaveProperty('totalVentas');
    expect(primerNegocio.totalUsuarios).toBeGreaterThanOrEqual(1);
  });

  it('crea un nuevo local, lista sus usuarios y permite editarlo', async () => {
    const nombreAleatorio = `Bodega Central ${Date.now()}`;
    const usuarioAleatorio = `dueno_${Date.now()}`;

    // 1. Crear local
    const creacion = await request(app)
      .post('/api/plataforma/negocios')
      .set('x-plataforma-token', token)
      .send({
        nombre: nombreAleatorio,
        ubicacion: 'Nave W, Local 14',
        telefono: '55 9876 5432',
        dueno: {
          nombre: 'Don Fernando',
          usuario: usuarioAleatorio,
          contrasena: 'claveSuper123',
        },
      })
      .expect(200);

    const negocioId = creacion.body.negocio_id;
    const duenoId = creacion.body.dueno_id;
    expect(negocioId).toBeDefined();

    // 2. Consultar detalle del local
    const detalle = await request(app)
      .get(`/api/plataforma/negocios/${negocioId}`)
      .set('x-plataforma-token', token)
      .expect(200);

    expect(detalle.body.nombre).toBe(nombreAleatorio);
    expect(detalle.body.usuarios.length).toBe(1);
    expect(detalle.body.usuarios[0].usuario).toBe(usuarioAleatorio.toLowerCase());

    // 3. Editar datos del local
    const edicion = await request(app)
      .patch(`/api/plataforma/negocios/${negocioId}`)
      .set('x-plataforma-token', token)
      .send({
        nombre: `${nombreAleatorio} - Sucursal Sur`,
        telefono: '55 1111 2222',
      })
      .expect(200);

    expect(edicion.body.nombre).toBe(`${nombreAleatorio} - Sucursal Sur`);

    // 4. Agregar un nuevo empleado / trabajador al local
    const nuevoTrabajador = await request(app)
      .post(`/api/plataforma/negocios/${negocioId}/usuarios`)
      .set('x-plataforma-token', token)
      .send({
        nombre: 'Pedro Empleado',
        usuario: `pedro_${Date.now()}`,
        contrasena: 'claveTrabajador123',
        rolBase: 'trabajador',
      })
      .expect(200);

    expect(nuevoTrabajador.body.id).toBeDefined();

    // 5. Suspender y reactivar al Dueño desde el panel SuperAdmin
    const suspender = await request(app)
      .patch(`/api/plataforma/usuarios/${duenoId}/estado`)
      .set('x-plataforma-token', token)
      .send({ activo: false })
      .expect(200);

    expect(suspender.body.activo).toBe(false);

    const reactivar = await request(app)
      .patch(`/api/plataforma/usuarios/${duenoId}/estado`)
      .set('x-plataforma-token', token)
      .send({ activo: true })
      .expect(200);

    expect(reactivar.body.activo).toBe(true);

    // 6. Resetear contraseña de usuario desde el panel SuperAdmin
    const reset = await request(app)
      .post(`/api/plataforma/usuarios/${duenoId}/resetear-clave`)
      .set('x-plataforma-token', token)
      .send({ contrasena: 'nuevaClaveSegura2026' })
      .expect(200);

    expect(reset.body.ok).toBe(true);
  });
});
