import type { EntradaHistorial, ResumenReportes } from '@micentralmx/shared/api';
import { and, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { auditoria, liquidaciones, negocios, proveedores } from '../db/esquema';
import { rutaNegocio } from '../http/ruta';
import { registrarAuditoria } from '../lib/auditoria';
import { aCantidad, aImporte, D } from '../lib/dinero';

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
    return { id: n.id, nombre: n.nombre, telefono: n.telefono, ubicacion: n.ubicacion, ventanaOfflineHoras: n.ventanaOfflineHoras, plazoCreditoDias: n.plazoCreditoDias };
  }),
);

rutasConsultas.patch(
  '/configuracion',
  rutaNegocio('configuracion.editar', async ({ tx, usuario, req }) => {
    const d = z
      .object({
        nombre: z.string().trim().min(1).max(120),
        telefono: z.string().trim().max(30).nullable(),
        ubicacion: z.string().trim().max(200).nullable(),
        ventanaOfflineHoras: z.number().int().min(1, 'Mínimo 1 hora.').max(72, 'Máximo 72 horas.'),
        plazoCreditoDias: z.number().int().min(1).max(120),
      })
      .parse(req.body);
    const [antes] = await tx.select().from(negocios).where(eq(negocios.id, usuario.negocioId));
    await tx.update(negocios).set({ ...d, telefono: d.telefono || null, ubicacion: d.ubicacion || null }).where(eq(negocios.id, usuario.negocioId));
    await registrarAuditoria(tx, usuario, 'configuracion', `${usuario.nombre} cambió la configuración del negocio`, {
      tabla: 'negocios',
      registroId: usuario.negocioId,
      antes,
      despues: d,
    });
    return { id: antes.id, ...d, telefono: d.telefono || null, ubicacion: d.ubicacion || null };
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

rutasConsultas.get(
  '/reportes/productores',
  rutaNegocio('reportes.ver', async ({ tx, usuario, req }) => {
    const { desde, hasta, agrupacion } = z
      .object({
        desde: z.string().optional(),
        hasta: z.string().optional(),
        agrupacion: z.enum(['semana', 'quincena', 'mes']).default('mes'),
      })
      .parse(req.query);

    const provs = await tx
      .select()
      .from(proveedores)
      .where(and(eq(proveedores.negocioId, usuario.negocioId), isNull(proveedores.archivadoEn), eq(proveedores.tipo, 'tercero')));

    const zona = config.zonaHoraria;
    const diaCol = (col: string) => sql.raw(`(${col} at time zone '${zona}')::date`);
    const filtroFecha = desde && hasta ? sql`${diaCol('creado_en')} between ${desde} and ${hasta}` : sql`true`;

    const liqs = await tx
      .select()
      .from(liquidaciones)
      .where(and(eq(liquidaciones.negocioId, usuario.negocioId), filtroFecha));

    let porPagarTotalD = D(0);
    const mapaProd = new Map<
      string,
      {
        proveedorId: string;
        nombre: string;
        totalVendido: ReturnType<typeof D>;
        unidadesVendidas: ReturnType<typeof D>;
        comisionGanada: ReturnType<typeof D>;
        netoLiquidado: ReturnType<typeof D>;
        cortes: number;
        saldoActual: string;
      }
    >();

    for (const p of provs) {
      const { rows: rLiq } = await tx.execute<{ total: string }>(
        sql`select coalesce(sum(neto), 0)::text as total from liquidaciones where negocio_id = ${usuario.negocioId} and proveedor_id = ${p.id}`,
      );
      const { rows: rAjuste } = await tx.execute<{ abonos: string; cargos: string }>(
        sql`select coalesce(sum(case when tipo = 'abono' then monto else 0 end), 0)::text as abonos,
                   coalesce(sum(case when tipo = 'cargo' then monto else 0 end), 0)::text as cargos
            from ajustes_productor where negocio_id = ${usuario.negocioId} and proveedor_id = ${p.id}`,
      );
      const { rows: rDinero } = await tx.execute<{ pagos: string; anticipos: string }>(
        sql`select coalesce(sum(case when categoria = 'pago_proveedor' then monto else 0 end), 0)::text as pagos,
                   coalesce(sum(case when categoria = 'anticipo_productor' then monto else 0 end), 0)::text as anticipos
            from movimientos_dinero where negocio_id = ${usuario.negocioId} and proveedor_id = ${p.id}`,
      );
      const saldo = D(rLiq[0]?.total ?? 0)
        .plus(rAjuste[0]?.abonos ?? 0)
        .minus(rAjuste[0]?.cargos ?? 0)
        .minus(rDinero[0]?.pagos ?? 0)
        .minus(rDinero[0]?.anticipos ?? 0);

      if (saldo.gt(0)) porPagarTotalD = porPagarTotalD.plus(saldo);

      mapaProd.set(p.id, {
        proveedorId: p.id,
        nombre: p.nombre,
        totalVendido: D(0),
        unidadesVendidas: D(0),
        comisionGanada: D(0),
        netoLiquidado: D(0),
        cortes: 0,
        saldoActual: aImporte(saldo),
      });
    }

    const mapaPeriodos = new Map<
      string,
      { totalVendido: ReturnType<typeof D>; comisionGanada: ReturnType<typeof D>; netoLiquidado: ReturnType<typeof D>; cortes: number }
    >();

    for (const l of liqs) {
      const p = mapaProd.get(l.proveedorId);
      if (p) {
        p.totalVendido = p.totalVendido.plus(l.totalVendido);
        p.unidadesVendidas = p.unidadesVendidas.plus(l.unidadesVendidas);
        p.comisionGanada = p.comisionGanada.plus(l.comisionFinal);
        p.netoLiquidado = p.netoLiquidado.plus(l.neto);
        p.cortes += 1;
      }

      const f = new Date(l.creadoEn);
      let clavePeriodo = '';
      if (agrupacion === 'semana') {
        const anyo = f.getFullYear();
        const primero = new Date(anyo, 0, 1);
        const dias = Math.floor((f.getTime() - primero.getTime()) / (24 * 60 * 60 * 1000));
        const semana = Math.ceil((dias + primero.getDay() + 1) / 7);
        clavePeriodo = `${anyo}-Semana ${semana}`;
      } else if (agrupacion === 'quincena') {
        const anyo = f.getFullYear();
        const mes = String(f.getMonth() + 1).padStart(2, '0');
        const quincena = f.getDate() <= 15 ? 'Q1' : 'Q2';
        clavePeriodo = `${anyo}-${mes} ${quincena}`;
      } else {
        const anyo = f.getFullYear();
        const mes = String(f.getMonth() + 1).padStart(2, '0');
        clavePeriodo = `${anyo}-${mes}`;
      }

      const prevPeriodo = mapaPeriodos.get(clavePeriodo) ?? {
        totalVendido: D(0),
        comisionGanada: D(0),
        netoLiquidado: D(0),
        cortes: 0,
      };
      prevPeriodo.totalVendido = prevPeriodo.totalVendido.plus(l.totalVendido);
      prevPeriodo.comisionGanada = prevPeriodo.comisionGanada.plus(l.comisionFinal);
      prevPeriodo.netoLiquidado = prevPeriodo.netoLiquidado.plus(l.neto);
      prevPeriodo.cortes += 1;
      mapaPeriodos.set(clavePeriodo, prevPeriodo);
    }

    return {
      desde: desde ?? '',
      hasta: hasta ?? '',
      porPagarTotal: aImporte(porPagarTotalD),
      productores: Array.from(mapaProd.values()).map((p) => ({
        proveedorId: p.proveedorId,
        nombre: p.nombre,
        totalVendido: aImporte(p.totalVendido),
        unidadesVendidas: aCantidad(p.unidadesVendidas),
        comisionGanada: aImporte(p.comisionGanada),
        netoLiquidado: aImporte(p.netoLiquidado),
        cortes: p.cortes,
        saldoActual: p.saldoActual,
      })),
      periodos: Array.from(mapaPeriodos.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([periodo, v]) => ({
          periodo,
          totalVendido: aImporte(v.totalVendido),
          comisionGanada: aImporte(v.comisionGanada),
          netoLiquidado: aImporte(v.netoLiquidado),
          cortes: v.cortes,
        })),
    };
  }),
);

