import type {
  EntradaHistorial,
  GranularidadReporte,
  ProductoVendidoReporte,
  PuntoSerieReporte,
  ResumenReportes,
} from '@micentralmx/shared/api';
import { and, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { auditoria, liquidaciones, negocios, proveedores } from '../db/esquema';
import { rutaNegocio } from '../http/ruta';
import { registrarAuditoria } from '../lib/auditoria';
import { aCantidad, aImporte, D, sumar } from '../lib/dinero';

export const rutasConsultas = Router();

const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function sumarDiasFecha(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

function diffDiasFecha(a: string, b: string): number {
  const [aa, ma, da] = a.split('-').map(Number);
  const [ab, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(ab, mb - 1, db) - Date.UTC(aa, ma - 1, da)) / 86_400_000);
}

function etiquetaDiaCorto(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return `${DIAS_CORTO[dow]} ${String(d).padStart(2, '0')}`;
}

function inferirGranularidad(desde: string, hasta: string, explicita?: GranularidadReporte): GranularidadReporte {
  if (explicita) return explicita;
  const dias = diffDiasFecha(desde, hasta);
  if (dias <= 0) return 'dia';
  if (dias <= 13) return 'semana';
  return 'mes';
}

function rangoAnterior(desde: string, hasta: string, granularidad: GranularidadReporte): [string, string] {
  if (granularidad === 'mes' && desde.endsWith('-01')) {
    const [a, m] = desde.split('-').map(Number);
    const prevMes = m === 1 ? 12 : m - 1;
    const prevAnyo = m === 1 ? a - 1 : a;
    const prevDesde = `${prevAnyo}-${String(prevMes).padStart(2, '0')}-01`;
    const ultimoDiaPrev = new Date(Date.UTC(prevAnyo, prevMes, 0)).getUTCDate();
    const esMesCompleto = sumarDiasFecha(hasta, 1).endsWith('-01');
    const diaTope = esMesCompleto ? ultimoDiaPrev : Math.min(Number(hasta.slice(8, 10)), ultimoDiaPrev);
    const prevHasta = `${prevAnyo}-${String(prevMes).padStart(2, '0')}-${String(diaTope).padStart(2, '0')}`;
    return [prevDesde, prevHasta];
  }
  const dias = diffDiasFecha(desde, hasta) + 1;
  const prevHasta = sumarDiasFecha(desde, -1);
  const prevDesde = sumarDiasFecha(prevHasta, -(dias - 1));
  return [prevDesde, prevHasta];
}

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
    const q = z
      .object({
        desde: z.iso.date(),
        hasta: z.iso.date(),
        granularidad: z.enum(['dia', 'semana', 'mes']).optional(),
      })
      .parse(req.query);
    const desde = q.desde <= q.hasta ? q.desde : q.hasta;
    const hasta = q.desde <= q.hasta ? q.hasta : q.desde;
    const granularidad = inferirGranularidad(desde, hasta, q.granularidad);
    const [prevDesde, prevHasta] = rangoAnterior(desde, hasta, granularidad);

    const zona = config.zonaHoraria;
    const dia = (col: string) => sql.raw(`(${col} at time zone '${zona}')::date`);
    const hora = (col: string) => sql.raw(`extract(hour from (${col} at time zone '${zona}'))::int`);

    const r = await tx.execute<Record<string, string | null>>(sql`
      with
        v as (select * from ventas where estado <> 'cancelada' and ${dia('creado_en_dispositivo')} between ${desde}::date and ${hasta}::date),
        c as (select * from compras where ${dia('creado_en_dispositivo')} between ${desde}::date and ${hasta}::date),
        p as (select * from pagos where ${dia('creado_en_dispositivo')} between ${desde}::date and ${hasta}::date),
        d as (select * from movimientos_dinero where ${dia('creado_en')} between ${desde}::date and ${hasta}::date),
        m as (select mi.delta, cl.ultimo_costo from movimientos_inventario mi join clasificaciones cl on cl.id = mi.clasificacion_id
              where mi.tipo = 'merma' and ${dia('mi.creado_en')} between ${desde}::date and ${hasta}::date),
        pv as (select * from ventas where estado <> 'cancelada' and ${dia('creado_en_dispositivo')} between ${prevDesde}::date and ${prevHasta}::date),
        pp as (select * from pagos where ${dia('creado_en_dispositivo')} between ${prevDesde}::date and ${prevHasta}::date),
        pd as (select * from movimientos_dinero where ${dia('creado_en')} between ${prevDesde}::date and ${prevHasta}::date),
        abiertas as (select total - pagado as saldo, vence_el from ventas
                     where forma_pago = 'credito' and estado <> 'cancelada' and pagado < total),
        inv as (select p.id, e.cantidad, p.umbral_bajo from productos p
                join clasificaciones cl on cl.producto_id = p.id and cl.archivado_en is null
                left join existencias e on e.clasificacion_id = cl.id
                where p.archivado_en is null)
      select
        (select coalesce(sum(total), 0) from v) as ventas_total,
        (select count(*) from v) as ventas_cantidad,
        (select count(*) from v where forma_pago = 'credito') as ventas_credito_cant,
        (select coalesce(sum(total), 0) from v where forma_pago = 'efectivo') as contado_efectivo,
        (select coalesce(sum(total), 0) from v where forma_pago = 'transferencia' and estado = 'completada') as contado_transferencia,
        (select coalesce(sum(total), 0) from v where forma_pago = 'transferencia' and estado = 'por_confirmar') as transferencia_por_confirmar,
        (select coalesce(sum(total), 0) from v where forma_pago = 'credito') as ventas_credito_total,
        (select coalesce(sum(total), 0) from c) as compras_total,
        (select count(*) from c) as compras_cantidad,
        (select count(distinct proveedor_id) from c) as compras_proveedores,
        (select count(distinct id) from inv) as productos,
        (select count(*) from inv where cantidad > 0 and cantidad <= umbral_bajo) as bajos,
        (select coalesce(sum(monto), 0) from p) as abonos_deudas,
        (select coalesce(sum(monto), 0) from d where tipo = 'ingreso') as otros_ingresos,
        (select coalesce(sum(monto), 0) from d where tipo = 'egreso') as egresos,
        (select coalesce(sum(saldo), 0) from abiertas) as por_cobrar,
        (select coalesce(sum(saldo), 0) from abiertas where vence_el < (now() at time zone ${zona})::date) as vencido,
        (select coalesce(sum(abs(delta) * coalesce(ultimo_costo, 0)), 0) from m) as mermas_valor,
        (select coalesce(sum(abs(delta)), 0) from m) as mermas_cantidad,
        (select coalesce(sum(total), 0) from pv) as prev_ventas_total,
        (select count(*) from pv) as prev_ventas_cantidad,
        (select coalesce(sum(total), 0) from pv where forma_pago = 'efectivo' or (forma_pago = 'transferencia' and estado = 'completada')) as prev_ventas_contado,
        (select coalesce(sum(monto), 0) from pp) as prev_abonos,
        (select coalesce(sum(monto), 0) from pd where tipo = 'ingreso') as prev_otros_ingresos`);
    const f = r.rows[0];

    const ventasTotalD = D(f.ventas_total);
    const ventasCantidad = Number(f.ventas_cantidad);
    const contadoEfectivoD = D(f.contado_efectivo);
    const contadoTransferenciaD = D(f.contado_transferencia);
    const ventasContadoD = contadoEfectivoD.plus(contadoTransferenciaD);
    const abonosDeudasD = D(f.abonos_deudas);
    const otrosIngresosD = D(f.otros_ingresos);
    const totalIngresosD = ventasContadoD.plus(abonosDeudasD).plus(otrosIngresosD);
    const egresosD = D(f.egresos);
    const balanceNetoD = totalIngresosD.minus(egresosD);
    const ticketPromedioD = ventasCantidad > 0 ? ventasTotalD.div(ventasCantidad) : D(0);
    const prevIngresosTotalD = sumar([D(f.prev_ventas_contado), D(f.prev_abonos), D(f.prev_otros_ingresos)]);

    // Serie temporal
    let serie: PuntoSerieReporte[] = [];
    if (granularidad === 'dia' && desde === hasta) {
      const franjas = [
        { clave: '00-07', etiqueta: 'Madrugada' },
        { clave: '07-12', etiqueta: 'Mañana' },
        { clave: '12-17', etiqueta: 'Tarde' },
        { clave: '17-24', etiqueta: 'Noche' },
      ];
      const idxFranja = (col: string) =>
        sql.raw(`case when ${hora(col)} < 7 then 0 when ${hora(col)} < 12 then 1 when ${hora(col)} < 17 then 2 else 3 end`);

      const [rv, rp, rd] = await Promise.all([
        tx.execute<{ idx: number; total: string; contado: string; credito: string; cant: string }>(sql`
          select ${idxFranja('creado_en_dispositivo')} as idx,
                 coalesce(sum(total), 0)::text as total,
                 coalesce(sum(case when forma_pago = 'efectivo' or (forma_pago = 'transferencia' and estado = 'completada') then total else 0 end), 0)::text as contado,
                 coalesce(sum(case when forma_pago = 'credito' then total else 0 end), 0)::text as credito,
                 count(*)::text as cant
          from ventas
          where estado <> 'cancelada' and ${dia('creado_en_dispositivo')} = ${desde}::date
          group by idx`),
        tx.execute<{ idx: number; abonos: string }>(sql`
          select ${idxFranja('creado_en_dispositivo')} as idx,
                 coalesce(sum(monto), 0)::text as abonos
          from pagos
          where ${dia('creado_en_dispositivo')} = ${desde}::date
          group by idx`),
        tx.execute<{ idx: number; otros: string; egresos: string }>(sql`
          select ${idxFranja('creado_en')} as idx,
                 coalesce(sum(case when tipo = 'ingreso' then monto else 0 end), 0)::text as otros,
                 coalesce(sum(case when tipo = 'egreso' then monto else 0 end), 0)::text as egresos
          from movimientos_dinero
          where ${dia('creado_en')} = ${desde}::date
          group by idx`),
      ]);
      const mv = new Map(rv.rows.map((x) => [Number(x.idx), x]));
      const mp = new Map(rp.rows.map((x) => [Number(x.idx), x]));
      const md = new Map(rd.rows.map((x) => [Number(x.idx), x]));

      serie = franjas.map((fr, idx) => {
        const vx = mv.get(idx);
        const px = mp.get(idx);
        const dx = md.get(idx);
        const vCont = D(vx?.contado);
        const ab = D(px?.abonos);
        const ot = D(dx?.otros);
        return {
          clave: fr.clave,
          etiqueta: fr.etiqueta,
          desde,
          hasta,
          ventasTotal: aImporte(D(vx?.total)),
          ventasContado: aImporte(vCont),
          ventasCredito: aImporte(D(vx?.credito)),
          ingresosTotal: aImporte(vCont.plus(ab).plus(ot)),
          abonos: aImporte(ab),
          egresos: aImporte(D(dx?.egresos)),
          cantidadVentas: Number(vx?.cant ?? 0),
        };
      });
    } else {
      const [rv, rp, rd] = await Promise.all([
        tx.execute<{ dia: string; total: string; contado: string; credito: string; cant: string }>(sql`
          select ${dia('creado_en_dispositivo')}::text as dia,
                 coalesce(sum(total), 0)::text as total,
                 coalesce(sum(case when forma_pago = 'efectivo' or (forma_pago = 'transferencia' and estado = 'completada') then total else 0 end), 0)::text as contado,
                 coalesce(sum(case when forma_pago = 'credito' then total else 0 end), 0)::text as credito,
                 count(*)::text as cant
          from ventas
          where estado <> 'cancelada' and ${dia('creado_en_dispositivo')} between ${desde}::date and ${hasta}::date
          group by dia`),
        tx.execute<{ dia: string; abonos: string }>(sql`
          select ${dia('creado_en_dispositivo')}::text as dia,
                 coalesce(sum(monto), 0)::text as abonos
          from pagos
          where ${dia('creado_en_dispositivo')} between ${desde}::date and ${hasta}::date
          group by dia`),
        tx.execute<{ dia: string; otros: string; egresos: string }>(sql`
          select ${dia('creado_en')}::text as dia,
                 coalesce(sum(case when tipo = 'ingreso' then monto else 0 end), 0)::text as otros,
                 coalesce(sum(case when tipo = 'egreso' then monto else 0 end), 0)::text as egresos
          from movimientos_dinero
          where ${dia('creado_en')} between ${desde}::date and ${hasta}::date
          group by dia`),
      ]);
      const mv = new Map(rv.rows.map((x) => [x.dia, x]));
      const mp = new Map(rp.rows.map((x) => [x.dia, x]));
      const md = new Map(rd.rows.map((x) => [x.dia, x]));

      const totalDias = diffDiasFecha(desde, hasta) + 1;
      const porSemanas = (granularidad === 'mes' && totalDias > 14) || totalDias > 62;
      if (porSemanas) {
        let cur = desde;
        let sem = 1;
        while (cur <= hasta) {
          const finPropuesto = sumarDiasFecha(cur, 6);
          const fin = finPropuesto <= hasta ? finPropuesto : hasta;
          let vTot = D(0);
          let vCont = D(0);
          let vCred = D(0);
          let ab = D(0);
          let ot = D(0);
          let eg = D(0);
          let cant = 0;
          let d = cur;
          while (d <= fin) {
            const vx = mv.get(d);
            const px = mp.get(d);
            const dx = md.get(d);
            if (vx) {
              vTot = vTot.plus(vx.total);
              vCont = vCont.plus(vx.contado);
              vCred = vCred.plus(vx.credito);
              cant += Number(vx.cant);
            }
            if (px) ab = ab.plus(px.abonos);
            if (dx) {
              ot = ot.plus(dx.otros);
              eg = eg.plus(dx.egresos);
            }
            d = sumarDiasFecha(d, 1);
          }
          const mismoMes = cur.slice(0, 7) === fin.slice(0, 7);
          const etiqueta = mismoMes
            ? `Sem ${sem} (${cur.slice(8, 10)}–${fin.slice(8, 10)})`
            : `Sem ${sem} (${cur.slice(8, 10)}/${cur.slice(5, 7)})`;
          serie.push({
            clave: cur,
            etiqueta,
            desde: cur,
            hasta: fin,
            ventasTotal: aImporte(vTot),
            ventasContado: aImporte(vCont),
            ventasCredito: aImporte(vCred),
            ingresosTotal: aImporte(vCont.plus(ab).plus(ot)),
            abonos: aImporte(ab),
            egresos: aImporte(eg),
            cantidadVentas: cant,
          });
          cur = sumarDiasFecha(fin, 1);
          sem++;
        }
      } else {
        let cur = desde;
        while (cur <= hasta) {
          const vx = mv.get(cur);
          const px = mp.get(cur);
          const dx = md.get(cur);
          const vCont = D(vx?.contado);
          const ab = D(px?.abonos);
          const ot = D(dx?.otros);
          serie.push({
            clave: cur,
            etiqueta: etiquetaDiaCorto(cur),
            desde: cur,
            hasta: cur,
            ventasTotal: aImporte(D(vx?.total)),
            ventasContado: aImporte(vCont),
            ventasCredito: aImporte(D(vx?.credito)),
            ingresosTotal: aImporte(vCont.plus(ab).plus(ot)),
            abonos: aImporte(ab),
            egresos: aImporte(D(dx?.egresos)),
            cantidadVentas: Number(vx?.cant ?? 0),
          });
          cur = sumarDiasFecha(cur, 1);
        }
      }
    }

    // Top 5 productos / clasificaciones más vendidos
    const rTop = await tx.execute<{
      producto_id: string;
      nombre: string;
      clasificacion: string;
      unidad: string;
      cantidad: string;
      importe: string;
    }>(sql`
      select vr.producto_id,
             max(vr.producto_nombre) as nombre,
             max(vr.clasificacion_nombre) as clasificacion,
             max(vr.unidad_plural) as unidad,
             coalesce(sum(vr.cantidad), 0)::text as cantidad,
             coalesce(sum(vr.importe), 0)::text as importe
      from venta_renglones vr
      join ventas v on v.id = vr.venta_id
      where v.estado <> 'cancelada'
        and ${dia('v.creado_en_dispositivo')} between ${desde}::date and ${hasta}::date
      group by vr.clasificacion_id, vr.producto_id
      order by sum(vr.importe) desc
      limit 5`);

    const topProductos: ProductoVendidoReporte[] = rTop.rows.map((row) => ({
      productoId: row.producto_id,
      nombre: row.nombre,
      clasificacion: row.clasificacion,
      unidad: row.unidad,
      cantidad: aCantidad(row.cantidad),
      importe: aImporte(row.importe),
    }));

    return {
      desde,
      hasta,
      granularidad,
      ventas: { total: aImporte(ventasTotalD), cantidad: ventasCantidad, aCredito: Number(f.ventas_credito_cant) },
      ventasDetalle: {
        contadoEfectivo: aImporte(contadoEfectivoD),
        contadoTransferencia: aImporte(contadoTransferenciaD),
        transferenciaPorConfirmar: aImporte(D(f.transferencia_por_confirmar)),
        credito: aImporte(D(f.ventas_credito_total)),
        ticketPromedio: aImporte(ticketPromedioD),
      },
      ingresosDetalle: {
        ventasContado: aImporte(ventasContadoD),
        abonosDeudas: aImporte(abonosDeudasD),
        otrosIngresos: aImporte(otrosIngresosD),
        totalIngresos: aImporte(totalIngresosD),
        egresos: aImporte(egresosD),
        balanceNeto: aImporte(balanceNetoD),
      },
      comparativa: {
        desde: prevDesde,
        hasta: prevHasta,
        ventasTotal: aImporte(D(f.prev_ventas_total)),
        ingresosTotal: aImporte(prevIngresosTotalD),
        cantidadVentas: Number(f.prev_ventas_cantidad),
      },
      serie,
      topProductos,
      compras: { total: aImporte(f.compras_total!), cantidad: Number(f.compras_cantidad), proveedores: Number(f.compras_proveedores) },
      inventario: { productos: Number(f.productos), bajos: Number(f.bajos) },
      pagos: { ingresos: aImporte(sumar([abonosDeudasD, otrosIngresosD])), egresos: aImporte(egresosD) },
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
            from movimientos_dinero
            where negocio_id = ${usuario.negocioId}
              and proveedor_id = ${p.id}
              and compra_id is null
              and concepto not ilike '%compra%'`,
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

