import type { EntradaHistorial, ResumenReportes } from '@micentralmx/shared/api';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { auditoria, negocios } from '../db/esquema';
import { rutaNegocio } from '../http/ruta';
import { registrarAuditoria } from '../lib/auditoria';
import { aImporte } from '../lib/dinero';

export const rutasConsultas = Router();

rutasConsultas.get(
  '/historial',
  rutaNegocio('historial.ver', async ({ tx, req }) => {
    const q = z.object({ categoria: z.string().max(40).optional(), q: z.string().max(120).optional() }).parse(req.query);
    // "inventario" incluye los cambios de catálogo, como en la pantalla del prototipo.
    const categoria = q.categoria === 'inventario' ? sql`${auditoria.categoria} in ('inventario', 'catalogo')` : q.categoria ? eq(auditoria.categoria, q.categoria) : undefined;
    const filas = await tx
      .select()
      .from(auditoria)
      .where(and(categoria, q.q?.trim() ? ilike(auditoria.descripcion, `%${q.q.trim().replace(/[%_]/g, '\\$&')}%`) : undefined))
      .orderBy(desc(auditoria.fecha))
      .limit(200);
    return filas.map(
      (f): EntradaHistorial => ({
        id: f.id,
        fecha: f.fecha.toISOString(),
        usuarioNombre: f.usuarioNombre,
        categoria: f.categoria as EntradaHistorial['categoria'],
        descripcion: f.descripcion,
      }),
    );
  }),
);

rutasConsultas.get(
  '/configuracion',
  rutaNegocio(null, async ({ tx, usuario }) => {
    const [n] = await tx.select().from(negocios).where(eq(negocios.id, usuario.negocioId));
    return { id: n.id, nombre: n.nombre, ubicacion: n.ubicacion, ventanaOfflineHoras: n.ventanaOfflineHoras, plazoCreditoDias: n.plazoCreditoDias };
  }),
);

rutasConsultas.patch(
  '/configuracion',
  rutaNegocio('configuracion.editar', async ({ tx, usuario, req }) => {
    const d = z
      .object({
        nombre: z.string().trim().min(1).max(120),
        ubicacion: z.string().trim().max(200).nullable(),
        ventanaOfflineHoras: z.number().int().min(1, 'Mínimo 1 hora.').max(72, 'Máximo 72 horas.'),
        plazoCreditoDias: z.number().int().min(1).max(120),
      })
      .parse(req.body);
    const [antes] = await tx.select().from(negocios).where(eq(negocios.id, usuario.negocioId));
    await tx.update(negocios).set({ ...d, ubicacion: d.ubicacion || null }).where(eq(negocios.id, usuario.negocioId));
    await registrarAuditoria(tx, usuario, 'configuracion', `${usuario.nombre} cambió la configuración del negocio`, {
      tabla: 'negocios',
      registroId: usuario.negocioId,
      antes,
      despues: d,
    });
    return null;
  }),
);

/** Reportes consolidados con la fecha del dispositivo en la zona del negocio (propuesta §8). */
rutasConsultas.get(
  '/reportes/resumen',
  rutaNegocio('reportes.ver', async ({ tx, req }) => {
    const { desde, hasta } = z.object({ desde: z.iso.date(), hasta: z.iso.date() }).parse(req.query);
    const zona = config.zonaHoraria;
    const dia = (col: string) => sql.raw(`(${col} at time zone '${zona}')::date`);
    const r = await tx.execute<Record<string, string | null>>(sql`
      with
        v as (select * from ventas where estado <> 'cancelada' and ${dia('creado_en_dispositivo')} between ${desde} and ${hasta}),
        c as (select * from compras where ${dia('creado_en_dispositivo')} between ${desde} and ${hasta}),
        p as (select * from pagos where ${dia('creado_en_dispositivo')} between ${desde} and ${hasta}),
        d as (select * from movimientos_dinero where ${dia('creado_en')} between ${desde} and ${hasta}),
        m as (select mi.delta, cl.ultimo_costo from movimientos_inventario mi join clasificaciones cl on cl.id = mi.clasificacion_id
              where mi.tipo = 'merma' and ${dia('mi.creado_en')} between ${desde} and ${hasta}),
        abiertas as (select total - pagado as saldo, vence_el from ventas
                     where forma_pago = 'credito' and estado <> 'cancelada' and pagado < total),
        inv as (select p.id, e.cantidad, p.umbral_bajo from productos p
                join clasificaciones cl on cl.producto_id = p.id and cl.archivado_en is null
                left join existencias e on e.clasificacion_id = cl.id
                where p.archivado_en is null)
      select
        (select coalesce(sum(total), 0) from v) as ventas_total,
        (select count(*) from v) as ventas_cantidad,
        (select count(*) from v where forma_pago = 'credito') as ventas_credito,
        (select coalesce(sum(total), 0) from c) as compras_total,
        (select count(*) from c) as compras_cantidad,
        (select count(distinct proveedor_id) from c) as compras_proveedores,
        (select count(distinct id) from inv) as productos,
        (select count(*) from inv where cantidad > 0 and cantidad <= umbral_bajo) as bajos,
        ((select coalesce(sum(monto), 0) from p) + (select coalesce(sum(monto), 0) from d where tipo = 'ingreso')) as ingresos,
        (select coalesce(sum(monto), 0) from d where tipo = 'egreso') as egresos,
        (select coalesce(sum(saldo), 0) from abiertas) as por_cobrar,
        (select coalesce(sum(saldo), 0) from abiertas where vence_el < (now() at time zone ${zona})::date) as vencido,
        (select coalesce(sum(abs(delta) * coalesce(ultimo_costo, 0)), 0) from m) as mermas_valor,
        (select coalesce(sum(abs(delta)), 0) from m) as mermas_cantidad`);
    const f = r.rows[0];
    return {
      desde,
      hasta,
      ventas: { total: aImporte(f.ventas_total!), cantidad: Number(f.ventas_cantidad), aCredito: Number(f.ventas_credito) },
      compras: { total: aImporte(f.compras_total!), cantidad: Number(f.compras_cantidad), proveedores: Number(f.compras_proveedores) },
      inventario: { productos: Number(f.productos), bajos: Number(f.bajos) },
      pagos: { ingresos: aImporte(f.ingresos!), egresos: aImporte(f.egresos!) },
      deudas: { porCobrar: aImporte(f.por_cobrar!), vencido: aImporte(f.vencido!) },
      mermas: { valor: aImporte(f.mermas_valor!), cantidad: String(Number(f.mermas_cantidad)), unidad: 'unidades' },
    } satisfies ResumenReportes;
  }),
);
