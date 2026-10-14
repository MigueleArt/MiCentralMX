/**
 * Semilla de DESARROLLO: crea "Bodega Hernández" con los mismos datos de prueba del modo demo
 * (frontend/src/demo/semilla.ts). Usuarios: rodolfo (Dueño), ana (Administrador),
 * carlos y luis (Trabajador); contraseña demo1234. No usar en producción.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { crearSemilla } from '../../frontend/src/demo/semilla';
import { hashContrasena } from '../src/auth/tokens';
import * as t from '../src/db/esquema';
import { crearNegocio } from '../src/modulos/plataforma';

export async function sembrar(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema: t });
  try {
    const s = crearSemilla();
    const rodolfo = s.usuarios.find((u) => u.usuario === 'rodolfo')!;
    const r = await crearNegocio(db, {
      nombre: s.negocio.nombre,
      ubicacion: s.negocio.ubicacion,
      dueno: { nombre: rodolfo.nombre, usuario: rodolfo.usuario, contrasena: rodolfo.contrasena },
    });
    const negocioId = r.negocioId;

    await db.transaction(async (tx) => {
      // Usuarios: los ids de la semilla se remapean a los creados aquí.
      const usuarioId = new Map<string, string>([[rodolfo.id, r.duenoId]]);
      const rolDe = (rolSemilla: string) => {
        const base = s.roles.find((x) => x.id === rolSemilla)!.base as 'administrador' | 'trabajador';
        return r.roles[base];
      };
      for (const u of s.usuarios.filter((x) => x.usuario !== 'rodolfo')) {
        await tx.insert(t.usuarios).values({
          id: u.id,
          negocioId,
          nombre: u.nombre,
          usuario: u.usuario,
          contrasenaHash: await hashContrasena(u.contrasena),
          rolId: rolDe(u.rolId),
          activo: true,
          ultimaActividad: u.ultimaActividad ? new Date(u.ultimaActividad) : null,
        });
        usuarioId.set(u.id, u.id);
      }
      const uid = (id: string) => usuarioId.get(id) ?? r.duenoId;

      const unidades = await tx.select().from(t.unidades).where(eq(t.unidades.negocioId, negocioId));
      const unidadPorNombre = new Map(unidades.map((u) => [u.nombre, u.id]));
      const unidadSemilla = new Map(s.unidades.map((u) => [u.id, u.nombre]));

      await tx.insert(t.productos).values(s.productos.map((p) => ({ id: p.id, negocioId, nombre: p.nombre, unidadId: unidadPorNombre.get(unidadSemilla.get(p.unidadId)!)!, umbralBajo: p.umbralBajo })));
      await tx.insert(t.clasificaciones).values(s.clasificaciones.map((c) => ({ ...c, negocioId, archivadoEn: null })));
      await tx.insert(t.existencias).values(s.existencias.map((e) => ({ ...e, negocioId })));
      await tx.insert(t.clientes).values(s.clientes.map((c) => ({ ...c, negocioId, creadoEn: new Date(c.creadoEn), archivadoEn: null })));
      await tx.insert(t.proveedores).values(s.proveedores.map((p) => ({ ...p, negocioId, archivadoEn: null })));

      for (const v of s.ventas) {
        await tx.insert(t.ventas).values({
          id: v.id,
          negocioId,
          folio: v.folio!,
          folioProvisional: null,
          clienteId: v.clienteId,
          clienteNombre: v.clienteNombre,
          formaPago: v.formaPago,
          estado: v.estado,
          total: v.total,
          pagado: v.pagado,
          venceEl: v.venceEl,
          usuarioId: uid(v.usuarioId),
          usuarioNombre: v.usuarioNombre,
          dispositivoId: null,
          creadoEnDispositivo: new Date(v.creadoEnDispositivo),
          requiereRevision: false,
          motivoRevision: null,
          canceladaEn: v.canceladaEn ? new Date(v.canceladaEn) : null,
        });
        await tx.insert(t.ventaRenglones).values(v.renglones.map((x, linea) => ({ ...x, ventaId: v.id, linea, negocioId })));
      }
      for (const p of s.pagos) {
        await tx.insert(t.pagos).values({ ...p, negocioId, usuarioId: uid(p.usuarioId), creadoEnDispositivo: new Date(p.creadoEnDispositivo) });
        await tx.insert(t.pagoAplicaciones).values(p.aplicaciones.map((a) => ({ ...a, pagoId: p.id, negocioId })));
      }
      for (const c of s.compras) {
        await tx.insert(t.compras).values({ ...c, folio: c.folio!, negocioId, usuarioId: uid(c.usuarioId), creadoEnDispositivo: new Date(c.creadoEnDispositivo) });
        await tx.insert(t.compraRenglones).values(c.renglones.map((x, linea) => ({ ...x, compraId: c.id, linea, negocioId })));
      }
      await tx.insert(t.movimientosInventario).values(s.movimientosInventario.map((m) => ({ ...m, negocioId, usuarioId: null, creadoEn: new Date(m.creadoEn) })));
      await tx.insert(t.movimientosDinero).values(s.movimientosDinero.map((m) => ({ ...m, negocioId, usuarioId: null, creadoEn: new Date(m.creadoEn) })));
      await tx.insert(t.auditoria).values(s.auditoria.map((a) => ({ ...a, negocioId, fecha: new Date(a.fecha) })));
      // Los siguientes bloques de folios empiezan después de los usados en la semilla.
      await tx.insert(t.contadores).values([
        { negocioId, clave: 'folio_venta', valor: s.siguienteFolio.venta - 1 },
        { negocioId, clave: 'folio_compra', valor: s.siguienteFolio.compra - 1 },
      ]);
    });
    return negocioId;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('Falta DATABASE_OWNER_URL');
  const id = await sembrar(url);
  console.log(`Negocio de prueba creado: ${id}. Usuarios rodolfo, ana, carlos, luis · contraseña demo1234`);
}
