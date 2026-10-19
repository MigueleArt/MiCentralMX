/** Productos, clasificaciones, ajustes de inventario, clientes y proveedores (solo en línea, §4.5). */
import { and, eq, isNull, notInArray } from 'drizzle-orm';
import { Router } from 'express';
import { v7 as uuid } from 'uuid';
import { z } from 'zod';
import { clasificaciones, clientes, existencias, existenciasCarga, productos, proveedores, unidades } from '../db/esquema';
import { invalido, noEncontrado } from '../http/errores';
import { exigir, rutaNegocio, type Contexto } from '../http/ruta';
import { registrarAuditoria } from '../lib/auditoria';
import { aImporte, D, formatoMXN } from '../lib/dinero';
import { moverExistencia } from '../lib/inventario';
import * as mapa from '../lib/mapeo';

const decimal = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^\d+(\.\d+)?$/.test(v), 'debe ser un número positivo');

const esquemaProducto = z.object({
  nombre: z.string().trim().min(1, 'Escribe el nombre del producto.').max(120),
  unidadId: z.uuid(),
  umbralBajo: decimal,
  clasificaciones: z
    .array(z.object({ id: z.uuid(), nombre: z.string().trim().min(1).max(80), precio: decimal, existenciaInicial: decimal.optional() }))
    .min(1, 'Agrega al menos una clasificación.')
    .max(20),
});

async function guardarProducto({ tx, usuario, req }: Contexto, id: string | null) {
  const d = esquemaProducto.parse(req.body);
  const [u] = await tx.select().from(unidades).where(eq(unidades.id, d.unidadId));
  if (!u) throw invalido('Elige cómo se vende el producto.');
  const previo = id ? (await tx.select().from(productos).where(eq(productos.id, id)))[0] : undefined;
  if (id && !previo) throw noEncontrado('El producto no existe.');
  if (previo?.archivadoEn) throw invalido('El producto está archivado.');

  const productoId = id ?? uuid();
  const valores = { nombre: d.nombre, unidadId: d.unidadId, umbralBajo: D(d.umbralBajo).toString() };
  if (previo) await tx.update(productos).set(valores).where(eq(productos.id, productoId));
  else await tx.insert(productos).values({ id: productoId, negocioId: usuario.negocioId, ...valores });

  const actuales = previo ? await tx.select().from(clasificaciones).where(eq(clasificaciones.productoId, productoId)) : [];
  for (const [orden, c] of d.clasificaciones.entries()) {
    const actual = actuales.find((x) => x.id === c.id);
    if (actual) {
      // Cambiar precios requiere su propio permiso (decisiones técnicas §2.9).
      if (!D(actual.precio).eq(c.precio)) {
        exigir(usuario, 'catalogo.editar_precios');
        await registrarAuditoria(tx, usuario, 'catalogo', `${usuario.nombre} cambió el precio de ${d.nombre} ${c.nombre} de ${formatoMXN(actual.precio)} a ${formatoMXN(c.precio)}`, {
          tabla: 'clasificaciones',
          registroId: c.id,
          antes: { precio: actual.precio },
          despues: { precio: aImporte(c.precio) },
        });
      }
      await tx.update(clasificaciones).set({ nombre: c.nombre, precio: aImporte(c.precio), orden, archivadoEn: null }).where(eq(clasificaciones.id, c.id));
      continue;
    }
    await tx.insert(clasificaciones).values({ id: c.id, negocioId: usuario.negocioId, productoId, nombre: c.nombre, precio: aImporte(c.precio), orden });
    await tx.insert(existencias).values({ clasificacionId: c.id, negocioId: usuario.negocioId, cantidad: '0' });
    if (c.existenciaInicial && D(c.existenciaInicial).gt(0)) {
      if (!u.permiteDecimales && !D(c.existenciaInicial).isInteger()) throw invalido('Esta unidad solo acepta cantidades enteras.');
      await moverExistencia(tx, {
        negocioId: usuario.negocioId,
        clasificacionId: c.id,
        productoId,
        delta: D(c.existenciaInicial).toString(),
        tipo: 'inicial',
        motivo: 'Existencia inicial',
        usuarioId: usuario.id,
        usuarioNombre: usuario.nombre,
        creadoEn: new Date(),
      });
    }
  }
  // Las clasificaciones que se quitaron se archivan; su historial se conserva.
  const conservar = d.clasificaciones.map((c) => c.id);
  if (previo) {
    await tx
      .update(clasificaciones)
      .set({ archivadoEn: new Date() })
      .where(and(eq(clasificaciones.productoId, productoId), notInArray(clasificaciones.id, conservar), isNull(clasificaciones.archivadoEn)));
  }
  await registrarAuditoria(tx, usuario, 'catalogo', `${usuario.nombre} ${previo ? 'editó' : 'agregó'} el producto ${d.nombre}`, {
    tabla: 'productos',
    registroId: productoId,
    antes: previo ? mapa.producto(previo) : undefined,
    despues: valores,
  });
  const [p] = await tx.select().from(productos).where(eq(productos.id, productoId));
  return mapa.producto(p);
}

export const rutasCatalogo = Router();

rutasCatalogo.post('/productos', rutaNegocio('catalogo.editar', (c) => guardarProducto(c, null)));
rutasCatalogo.patch('/productos/:id', rutaNegocio('catalogo.editar', (c) => guardarProducto(c, String(c.req.params.id))));

rutasCatalogo.post(
  '/productos/:id/archivar',
  rutaNegocio('catalogo.editar', async ({ tx, usuario, req }) => {
    const id = String(req.params.id);
    const [p] = await tx.select().from(productos).where(eq(productos.id, id));
    if (!p) throw noEncontrado('El producto no existe.');
    const ahora = new Date();
    await tx.update(productos).set({ archivadoEn: ahora }).where(eq(productos.id, id));
    await tx.update(clasificaciones).set({ archivadoEn: ahora }).where(and(eq(clasificaciones.productoId, id), isNull(clasificaciones.archivadoEn)));
    await registrarAuditoria(tx, usuario, 'catalogo', `${usuario.nombre} archivó el producto ${p.nombre}`, { tabla: 'productos', registroId: id });
    return null;
  }),
);

/** Ajuste por conteo físico: el servidor calcula la diferencia contra la existencia vigente (§3). */
rutasCatalogo.post(
  '/inventario/ajustes',
  rutaNegocio('inventario.ajustar', async ({ tx, usuario, req }) => {
    const d = z
      .object({
        clasificacionId: z.uuid(),
        cantidadContada: decimal,
        motivo: z.string().trim().max(200).default('Conteo físico'),
        cargaId: z.string().uuid().nullable().optional(),
      })
      .parse(req.body);
    const [c] = await tx
      .select({ c: clasificaciones, p: productos, u: unidades })
      .from(clasificaciones)
      .innerJoin(productos, eq(productos.id, clasificaciones.productoId))
      .innerJoin(unidades, eq(unidades.id, productos.unidadId))
      .where(eq(clasificaciones.id, d.clasificacionId));
    if (!c) throw noEncontrado('La clasificación no existe.');
    if (!c.u.permiteDecimales && !D(d.cantidadContada).isInteger()) throw invalido('Esta unidad solo acepta cantidades enteras.');

    let actual = D(0);
    if (d.cargaId) {
      const [ec] = await tx
        .select()
        .from(existenciasCarga)
        .where(and(eq(existenciasCarga.cargaId, d.cargaId), eq(existenciasCarga.clasificacionId, c.c.id)))
        .for('update');
      actual = D(ec?.cantidad ?? 0);
    } else {
      const [e] = await tx.select().from(existencias).where(eq(existencias.clasificacionId, c.c.id)).for('update');
      actual = D(e?.cantidad ?? 0);
    }
    const delta = D(d.cantidadContada).minus(actual);
    if (!delta.isZero()) {
      await moverExistencia(tx, {
        negocioId: usuario.negocioId,
        clasificacionId: c.c.id,
        productoId: c.p.id,
        delta: delta.toString(),
        tipo: 'ajuste',
        motivo: d.motivo || 'Conteo físico',
        cargaId: d.cargaId ?? undefined,
        usuarioId: usuario.id,
        usuarioNombre: usuario.nombre,
        creadoEn: new Date(),
      });
    }
    await registrarAuditoria(tx, usuario, 'inventario', `${usuario.nombre} ajustó ${c.p.nombre} ${c.c.nombre}: ${actual} → ${D(d.cantidadContada)}`, {
      tabla: d.cargaId ? 'existencias_carga' : 'existencias',
      registroId: c.c.id,
      antes: { cantidad: actual.toString() },
      despues: { cantidad: D(d.cantidadContada).toString() },
    });
    return { delta: delta.toString() };
  }),
);

rutasCatalogo.patch(
  '/clientes/:id',
  rutaNegocio('clientes.editar', async ({ tx, usuario, req }) => {
    const d = z
      .object({
        nombre: z.string().trim().min(2, 'Escribe el nombre del cliente.').max(160),
        telefono: z.string().trim().max(30).nullable(),
        ubicacion: z.string().trim().max(200).nullable(),
        plazoDias: z.number().int().min(1).max(120).nullable(),
      })
      .parse(req.body);
    const id = String(req.params.id);
    const [c] = await tx.select().from(clientes).where(eq(clientes.id, id));
    if (!c) throw noEncontrado('El cliente todavía no llega al servidor. Sincroniza e inténtalo de nuevo.');
    await tx.update(clientes).set({ nombre: d.nombre, telefono: d.telefono || null, ubicacion: d.ubicacion || null, plazoDias: d.plazoDias }).where(eq(clientes.id, id));
    await registrarAuditoria(tx, usuario, 'ventas', `${usuario.nombre} editó al cliente ${d.nombre}`, { tabla: 'clientes', registroId: id, antes: mapa.cliente(c), despues: d });
    return null;
  }),
);

const esquemaProveedor = z.object({
  nombre: z.string().trim().min(1, 'Escribe el nombre del proveedor.').max(160),
  telefono: z.string().trim().max(30).nullish(),
  productos: z.string().trim().max(300).default(''),
  tipo: z.enum(['tercero', 'rancho_propio']).default('tercero'),
  comisionTipo: z.enum(['porcentaje', 'por_unidad']).nullish(),
  comisionValor: decimal.nullish(),
});

rutasCatalogo.post(
  '/proveedores',
  rutaNegocio('proveedores.gestionar', async ({ tx, usuario, req }) => {
    const d = esquemaProveedor.parse(req.body);
    const id = uuid();
    await tx.insert(proveedores).values({
      id,
      negocioId: usuario.negocioId,
      nombre: d.nombre,
      telefono: d.telefono || null,
      productos: d.productos,
      tipo: d.tipo,
      comisionTipo: d.comisionTipo ?? null,
      comisionValor: d.comisionValor ? aImporte(d.comisionValor) : null,
    });
    await registrarAuditoria(tx, usuario, 'compras', `${usuario.nombre} agregó al proveedor o rancho ${d.nombre}`, { tabla: 'proveedores', registroId: id });
    return mapa.proveedor((await tx.select().from(proveedores).where(eq(proveedores.id, id)))[0]);
  }),
);

rutasCatalogo.patch(
  '/proveedores/:id',
  rutaNegocio('proveedores.gestionar', async ({ tx, usuario, req }) => {
    const d = esquemaProveedor.parse(req.body);
    const id = String(req.params.id);
    const [p] = await tx.select().from(proveedores).where(eq(proveedores.id, id));
    if (!p) throw noEncontrado('El proveedor no existe.');
    await tx
      .update(proveedores)
      .set({
        nombre: d.nombre,
        telefono: d.telefono || null,
        productos: d.productos,
        tipo: d.tipo,
        comisionTipo: d.comisionTipo ?? null,
        comisionValor: d.comisionValor ? aImporte(d.comisionValor) : null,
      })
      .where(eq(proveedores.id, id));
    await registrarAuditoria(tx, usuario, 'compras', `${usuario.nombre} editó al proveedor o rancho ${d.nombre}`, { tabla: 'proveedores', registroId: id, antes: mapa.proveedor(p), despues: d });
    return mapa.proveedor((await tx.select().from(proveedores).where(eq(proveedores.id, id)))[0]);
  }),
);

rutasCatalogo.patch(
  '/catalogo/precios',
  rutaNegocio('catalogo.editar_precios', async ({ tx, usuario, req }) => {
    const d = z
      .object({
        precios: z.array(z.object({ clasificacionId: z.uuid(), precio: decimal })).min(1),
      })
      .parse(req.body);
    for (const item of d.precios) {
      const [actual] = await tx.select().from(clasificaciones).where(eq(clasificaciones.id, item.clasificacionId));
      if (actual && !D(actual.precio).eq(item.precio)) {
        await tx.update(clasificaciones).set({ precio: aImporte(item.precio) }).where(eq(clasificaciones.id, item.clasificacionId));
        await registrarAuditoria(tx, usuario, 'catalogo', `${usuario.nombre} cambió el precio de clasificación a ${formatoMXN(item.precio)}`, {
          tabla: 'clasificaciones',
          registroId: item.clasificacionId,
          antes: { precio: actual.precio },
          despues: { precio: aImporte(item.precio) },
        });
      }
    }
    return { ok: true };
  }),
);

rutasCatalogo.patch(
  '/catalogo/unidades/:id',
  rutaNegocio('configuracion.editar', async ({ tx, usuario, req }) => {
    const id = String(req.params.id);
    const d = z.object({ permiteDecimales: z.boolean() }).parse(req.body);
    const [u] = await tx.select().from(unidades).where(eq(unidades.id, id));
    if (!u) throw noEncontrado('La unidad no existe.');
    await tx.update(unidades).set({ permiteDecimales: d.permiteDecimales }).where(eq(unidades.id, id));
    await registrarAuditoria(tx, usuario, 'configuracion', `${usuario.nombre} cambió decimales de unidad ${u.nombre} a ${d.permiteDecimales}`, {
      tabla: 'unidades',
      registroId: id,
    });
    return mapa.unidad((await tx.select().from(unidades).where(eq(unidades.id, id)))[0]);
  }),
);
