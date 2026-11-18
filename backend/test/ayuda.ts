import { createHash } from 'node:crypto';
import request from 'supertest';
import { v7 as uuid } from 'uuid';
import { crearApp } from '../src/app';

export const app = crearApp();

export interface Sesion {
  agente: ReturnType<typeof request.agent>;
  token: string;
  usuarioId: string;
  negocioId: string;
  dispositivoId: string;
  bloques: Array<{ tipo: string; desde: number; hasta: number }>;
  get: (ruta: string) => request.Test;
  post: (ruta: string, cuerpo?: object) => request.Test;
  patch: (ruta: string, cuerpo?: object) => request.Test;
  put: (ruta: string, cuerpo?: object) => request.Test;
}

/** Inicia sesión, registra un dispositivo y devuelve atajos con el token. */
export async function entrar(usuario: string, contrasena = 'demo1234'): Promise<Sesion> {
  const agente = request.agent(app);
  const r = await agente.post('/api/auth/login').send({ usuario, contrasena }).expect(200);
  const token = r.body.access_token as string;
  const auth = (t: request.Test) => t.set('Authorization', `Bearer ${token}`);
  const d = await auth(agente.post('/api/dispositivos').send({ nombre: 'pruebas' })).expect(200);
  return {
    agente,
    token,
    usuarioId: r.body.usuario.id,
    negocioId: r.body.negocio.id,
    dispositivoId: d.body.dispositivo_id,
    bloques: d.body.bloques,
    get: (ruta) => auth(agente.get(`/api${ruta}`)),
    post: (ruta, cuerpo = {}) => auth(agente.post(`/api${ruta}`).send(cuerpo)),
    patch: (ruta, cuerpo = {}) => auth(agente.patch(`/api${ruta}`).send(cuerpo)),
    put: (ruta, cuerpo = {}) => auth(agente.put(`/api${ruta}`).send(cuerpo)),
  };
}

export function operacion(s: Sesion, tipo: string, datos: object, opciones: { id?: string; creado?: string } = {}) {
  return {
    operacion_id: opciones.id ?? uuid(),
    tipo,
    usuario_id: s.usuarioId,
    creado_en_dispositivo: opciones.creado ?? new Date().toISOString(),
    hash: createHash('sha256').update(tipo + JSON.stringify(datos)).digest('hex'),
    datos,
  };
}

export async function empujar(s: Sesion, operaciones: object[], reloj = new Date().toISOString()) {
  const r = await s.post('/sync/push', { dispositivo_id: s.dispositivoId, reloj_dispositivo: reloj, version_contrato: 1, operaciones }).expect(200);
  return r.body.resultados as Array<{ operacion_id: string; estado: string; motivo?: string | null; resultado?: { folio?: number } | null }>;
}

export async function bajar(s: Sesion, cursor = '0') {
  return (await s.get(`/sync/pull?cursor=${cursor}`).expect(200)).body;
}

/** Busca una clasificación por nombres en la bajada inicial. */
export async function clasificacion(s: Sesion, producto: string, nombre: string) {
  const b = await bajar(s);
  const p = b.cambios.productos.find((x: { nombre: string }) => x.nombre === producto);
  const c = b.cambios.clasificaciones.find((x: { productoId: string; nombre: string }) => x.productoId === p.id && x.nombre === nombre);
  const e = b.cambios.existencias.find((x: { clasificacionId: string }) => x.clasificacionId === c.id);
  return { id: c.id as string, precio: c.precio as string, existencia: Number(e.cantidad) };
}

export function venta(s: Sesion, renglones: Array<{ clasificacionId: string; cantidad: string; precio: string }>, extra: object = {}) {
  return {
    id: uuid(),
    folio: s.bloques.find((b) => b.tipo === 'venta')!.desde,
    folioProvisional: null,
    clienteId: null,
    formaPago: 'efectivo',
    venceEl: null,
    renglones: renglones.map((r) => ({ ...r, precioReferencia: r.precio })),
    ...extra,
  };
}
