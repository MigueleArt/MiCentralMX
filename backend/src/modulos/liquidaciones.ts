import { and, asc, desc, eq, inArray, isNull, ne, notExists, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import {
  ajustesProductor,
  cargas,
  clasificaciones,
  liquidaciones,
  liquidacionConceptos,
  liquidacionRenglones,
  movimientosDinero,
  movimientosInventario,
  productos,
  proveedores,
  unidades,
  ventaRenglones,
  ventas,
} from '../db/esquema';
import { conflicto, ErrorHttp, noEncontrado } from '../http/errores';
import { rutaNegocio } from '../http/ruta';
import { registrarAuditoria } from '../lib/auditoria';
import { aCantidad, aImporte, D, folioLiquidacion, folioVenta, formatoMXN, sumar } from '../lib/dinero';
import * as mapa from '../lib/mapeo';
import { incrementar } from './dispositivos';

export const rutasLiquidaciones = Router();

const decimal = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d+)?$/.test(v), 'debe ser un número positivo');

// ── GET /liquidaciones/pendientes ────────────────────────────────────────────
rutasLiquidaciones.get(
  '/liquidaciones/pendientes',
  rutaNegocio('liquidaciones.ver', async ({ tx, usuario, req }) => {
    const proveedorId = z.uuid().parse(req.query.proveedorId);
    const [prov] = await tx.select().from(proveedores).where(eq(proveedores.id, proveedorId));
    if (!prov) throw noEncontrado('El proveedor no existe.');
    if (prov.tipo === 'rancho_propio') {
      return {
        proveedor: { id: prov.id, nombre: prov.nombre, comisionTipo: null, comisionValor: null, tipo: prov.tipo },
        cargas: [],
        renglones: [],
        mermas: [],
        anticiposEntregados: '0.00',
      };
    }

    // Cargas de este proveedor
    const filasCargas = await tx
      .select()
      .from(cargas)
      .where(and(eq(cargas.negocioId, usuario.negocioId), eq(cargas.proveedorId, proveedorId)))
      .orderBy(desc(cargas.fecha));
    const cargasIds = filasCargas.map((c) => c.id);
    const mapaCargas = new Map(filasCargas.map((c) => [c.id, c]));

    if (cargasIds.length === 0) {
      return {
        proveedor: { id: prov.id, nombre: prov.nombre, comisionTipo: prov.comisionTipo, comisionValor: prov.comisionValor, tipo: prov.tipo },
        cargas: [],
        renglones: [],
        mermas: [],
        anticiposEntregados: '0.00',
      };
    }

    // Ventas no canceladas de esas cargas, que no estén ya en liquidacion_renglones
    const renglonesVenta = await tx
      .select({
        ventaId: ventas.id,
        folioVenta: ventas.folio,
        fechaVenta: ventas.creadoEnDispositivo,
        linea: ventaRenglones.linea,
        clasificacionNombre: ventaRenglones.clasificacionNombre,
        cantidad: ventaRenglones.cantidad,
        unidadNombre: ventaRenglones.unidadNombre,
        precio: ventaRenglones.precio,
        importe: ventaRenglones.importe,
        cargaId: ventaRenglones.cargaId,
      })
      .from(ventaRenglones)
      .innerJoin(ventas, eq(ventas.id, ventaRenglones.ventaId))
      .where(
        and(
          eq(ventas.negocioId, usuario.negocioId),
          ne(ventas.estado, 'cancelada'),
          inArray(ventaRenglones.cargaId, cargasIds),
          notExists(
            tx
              .select()
              .from(liquidacionRenglones)
              .where(
                and(
                  eq(liquidacionRenglones.ventaId, ventaRenglones.ventaId),
                  eq(liquidacionRenglones.linea, ventaRenglones.linea),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(ventas.creadoEnDispositivo), asc(ventaRenglones.linea));

    const renglones = renglonesVenta.map((r) => {
      const c = r.cargaId ? mapaCargas.get(r.cargaId) : undefined;
      const comTipo = c?.comisionTipo ?? prov.comisionTipo ?? null;
      const comValor = c?.comisionValor ?? prov.comisionValor ?? null;
      return {
        ventaId: r.ventaId,
        folioVenta: r.folioVenta,
        fechaVenta: r.fechaVenta.toISOString(),
        linea: r.linea,
        clasificacionNombre: r.clasificacionNombre,
        cantidad: r.cantidad,
        unidadNombre: r.unidadNombre,
        precio: r.precio,
        importe: r.importe,
        cargaId: r.cargaId,
        fechaCarga: c?.fecha ?? null,
        comisionTipo: comTipo,
        comisionValor: comValor,
      };
    });

    // Mermas de estas cargas
    const filasMermas = await tx
      .select({
        id: movimientosInventario.id,
        cargaId: movimientosInventario.cargaId,
        fecha: movimientosInventario.creadoEn,
        clasificacionNombre: clasificaciones.nombre,
        cantidad: movimientosInventario.delta,
        unidadNombre: unidades.nombre,
        motivo: movimientosInventario.motivo,
        precio: clasificaciones.precio,
        ultimoCosto: clasificaciones.ultimoCosto,
      })
      .from(movimientosInventario)
      .innerJoin(clasificaciones, eq(clasificaciones.id, movimientosInventario.clasificacionId))
      .innerJoin(productos, eq(productos.id, clasificaciones.productoId))
      .innerJoin(unidades, eq(unidades.id, productos.unidadId))
      .where(
        and(
          eq(movimientosInventario.negocioId, usuario.negocioId),
          eq(movimientosInventario.tipo, 'merma'),
          inArray(movimientosInventario.cargaId, cargasIds),
        ),
      )
      .orderBy(desc(movimientosInventario.creadoEn));

    // Descontar mermas que ya hayan sido incluidas como conceptos de merma de este proveedor
    const conceptosPrevios = await tx
      .select({ concepto: liquidacionConceptos.concepto })
      .from(liquidacionConceptos)
      .innerJoin(liquidaciones, eq(liquidaciones.id, liquidacionConceptos.liquidacionId))
      .where(and(eq(liquidaciones.negocioId, usuario.negocioId), eq(liquidaciones.proveedorId, proveedorId), eq(liquidacionConceptos.tipo, 'merma')));
    const conceptosSet = new Set(conceptosPrevios.map((cp) => cp.concepto));

    const mermas = filasMermas
      .filter((m) => !conceptosSet.has(`Merma: ${m.clasificacionNombre} (${m.motivo ?? 'merma'}) [${m.id}]`))
      .map((m) => {
        const costoUnidad = m.ultimoCosto ?? m.precio;
        const montoSugerido = aImporte(D(m.cantidad).abs().mul(costoUnidad));
        return {
          id: m.id,
          cargaId: m.cargaId,
          fecha: m.fecha.toISOString(),
          clasificacionNombre: m.clasificacionNombre,
          cantidad: aCantidad(D(m.cantidad).abs()),
          unidadNombre: m.unidadNombre,
          motivo: m.motivo,
          montoSugerido,
        };
      });

    // Anticipos entregados (informativo)
    const { rows: rAnt } = await tx.execute<{ total: string }>(sql`
      select coalesce(sum(monto), 0)::text as total
      from movimientos_dinero
      where negocio_id = ${usuario.negocioId}
        and proveedor_id = ${proveedorId}
        and categoria = 'anticipo_productor'
    `);
    const anticiposEntregados = aImporte(rAnt[0]?.total ?? '0');

    return {
      proveedor: {
        id: prov.id,
        nombre: prov.nombre,
        comisionTipo: prov.comisionTipo,
        comisionValor: prov.comisionValor,
        tipo: prov.tipo,
      },
      cargas: filasCargas.map((c) => ({
        id: c.id,
        fecha: c.fecha,
        estado: c.estado,
        comisionTipo: c.comisionTipo,
        comisionValor: c.comisionValor,
      })),
      renglones,
      mermas,
      anticiposEntregados,
    };
  }),
);

// ── POST /liquidaciones (Emitir corte) ────────────────────────────────────────
const esquemaEmision = z.object({
  proveedorId: z.uuid(),
  periodoDesde: z.string().nullable().optional(),
  periodoHasta: z.string().nullable().optional(),
  renglones: z.array(z.object({ ventaId: z.uuid(), linea: z.number().int().min(0) })).min(1, 'Selecciona al menos un renglón.'),
  comisionTipo: z.enum(['porcentaje', 'por_unidad']),
  comisionValor: decimal,
  comisionFinal: decimal,
  comisionNota: z.string().max(500).nullable().optional(),
  conceptos: z
    .array(
      z.object({
        tipo: z.enum(['flete', 'tara', 'merma', 'otro']),
        concepto: z.string().trim().min(1, 'El concepto no puede estar vacío.').max(200),
        monto: decimal,
      }),
    )
    .default([]),
});

rutasLiquidaciones.post(
  '/liquidaciones',
  rutaNegocio('liquidaciones.gestionar', async ({ tx, usuario, req }) => {
    const b = esquemaEmision.parse(req.body);

    const [prov] = await tx.select().from(proveedores).where(eq(proveedores.id, b.proveedorId));
    if (!prov) throw noEncontrado('El productor no existe.');
    if (prov.tipo === 'rancho_propio') throw conflicto('Los ranchos propios no generan liquidaciones.');

    // Verificar renglones solicitados
    const ventaIds = [...new Set(b.renglones.map((r) => r.ventaId))];
    const filasVenta = await tx
      .select({
        ventaId: ventaRenglones.ventaId,
        linea: ventaRenglones.linea,
        estadoVenta: ventas.estado,
        folioVenta: ventas.folio,
        cargaId: ventaRenglones.cargaId,
        importe: ventaRenglones.importe,
        cantidad: ventaRenglones.cantidad,
        proveedorIdCarga: cargas.proveedorId,
        comisionTipoCarga: cargas.comisionTipo,
        comisionValorCarga: cargas.comisionValor,
      })
      .from(ventaRenglones)
      .innerJoin(ventas, eq(ventas.id, ventaRenglones.ventaId))
      .leftJoin(cargas, eq(cargas.id, ventaRenglones.cargaId))
      .where(and(eq(ventas.negocioId, usuario.negocioId), inArray(ventaRenglones.ventaId, ventaIds)));

    const mapaRenglonesDisponibles = new Map<string, (typeof filasVenta)[number]>();
    for (const f of filasVenta) {
      mapaRenglonesDisponibles.set(`${f.ventaId}:${f.linea}`, f);
    }

    // Verificar que ninguno haya sido cortado ya (bloqueo for update de corte concurrentes)
    const yaCortados = await tx
      .select({ ventaId: liquidacionRenglones.ventaId, linea: liquidacionRenglones.linea })
      .from(liquidacionRenglones)
      .where(
        and(
          eq(liquidacionRenglones.negocioId, usuario.negocioId),
          inArray(liquidacionRenglones.ventaId, ventaIds),
        ),
      );
    const cortadosSet = new Set(yaCortados.map((y) => `${y.ventaId}:${y.linea}`));

    const renglonesValidados: Array<{
      ventaId: string;
      linea: number;
      cargaId: string | null;
      importe: string;
      cantidad: string;
      comisionTipo: 'porcentaje' | 'por_unidad';
      comisionValor: string;
    }> = [];

    for (const sol of b.renglones) {
      const clave = `${sol.ventaId}:${sol.linea}`;
      if (cortadosSet.has(clave)) {
        throw conflicto(`El renglón ${sol.linea} de la venta ya fue incluido en otra liquidación.`);
      }
      const vr = mapaRenglonesDisponibles.get(clave);
      if (!vr) throw noEncontrado(`El renglón ${sol.linea} de la venta no existe.`);
      if (vr.estadoVenta === 'cancelada') throw conflicto(`La venta ${folioVenta(vr.folioVenta)} está cancelada.`);
      if (vr.proveedorIdCarga !== b.proveedorId) throw conflicto(`El renglón de la venta ${folioVenta(vr.folioVenta)} no pertenece a este productor.`);

      const comTipo = (vr.comisionTipoCarga ?? prov.comisionTipo ?? b.comisionTipo) as 'porcentaje' | 'por_unidad';
      const comValor = vr.comisionValorCarga ?? prov.comisionValor ?? b.comisionValor;
      renglonesValidados.push({
        ventaId: vr.ventaId,
        linea: vr.linea,
        cargaId: vr.cargaId,
        importe: vr.importe,
        cantidad: vr.cantidad,
        comisionTipo: comTipo,
        comisionValor: comValor,
      });
    }

    // Cálculo de comisión sugerida/calculada por carga (§8):
    // "Si cargas con comisiones distintas entran al mismo corte, calcula por carga y suma."
    const porCarga = new Map<string, { tipo: 'porcentaje' | 'por_unidad'; valor: string; total: ReturnType<typeof D>; unidades: ReturnType<typeof D> }>();
    let totalVendidoD = D(0);
    let unidadesVendidasD = D(0);

    for (const r of renglonesValidados) {
      const imp = D(r.importe);
      const cant = D(r.cantidad);
      totalVendidoD = totalVendidoD.plus(imp);
      unidadesVendidasD = unidadesVendidasD.plus(cant);

      const claveCarga = r.cargaId ?? 'sin_carga';
      const prev = porCarga.get(claveCarga) ?? { tipo: r.comisionTipo, valor: r.comisionValor, total: D(0), unidades: D(0) };
      prev.total = prev.total.plus(imp);
      prev.unidades = prev.unidades.plus(cant);
      porCarga.set(claveCarga, prev);
    }

    let comisionCalculadaD = D(0);
    for (const c of porCarga.values()) {
      if (c.tipo === 'porcentaje') {
        comisionCalculadaD = comisionCalculadaD.plus(c.total.mul(c.valor).div(100));
      } else {
        comisionCalculadaD = comisionCalculadaD.plus(c.unidades.mul(c.valor));
      }
    }

    const comisionCalculada = aImporte(comisionCalculadaD);
    const comisionFinal = aImporte(b.comisionFinal);

    // Si la comisión final difiere de la calculada, comision_nota es obligatoria
    if (!D(comisionFinal).equals(D(comisionCalculada)) && !b.comisionNota?.trim()) {
      throw new ErrorHttp(400, 'La nota de comisión es obligatoria cuando la comisión final difiere de la calculada.', 'nota_obligatoria');
    }

    const totalVendido = aImporte(totalVendidoD);
    const unidadesVendidas = aCantidad(unidadesVendidasD);
    const descuentosTotal = aImporte(sumar(b.conceptos.map((c) => D(c.monto))));
    const neto = aImporte(D(totalVendido).minus(D(comisionFinal)).minus(D(descuentosTotal)));

    const folio = await incrementar(tx, usuario.negocioId, 'folio_liquidacion', 1);
    const liquidacionId = crypto.randomUUID();
    const ahora = new Date();

    const [liq] = await tx
      .insert(liquidaciones)
      .values({
        id: liquidacionId,
        negocioId: usuario.negocioId,
        folio,
        proveedorId: b.proveedorId,
        periodoDesde: b.periodoDesde ?? null,
        periodoHasta: b.periodoHasta ?? null,
        totalVendido,
        unidadesVendidas,
        comisionTipo: b.comisionTipo,
        comisionValor: aImporte(b.comisionValor),
        comisionCalculada,
        comisionFinal,
        comisionNota: b.comisionNota?.trim() || null,
        descuentosTotal,
        neto,
        usuarioId: usuario.id,
        usuarioNombre: usuario.nombre,
        creadoEn: ahora,
      })
      .returning();

    // Insertar renglones de liquidación
    const renglonesInsertar = renglonesValidados.map((r) => ({
      liquidacionId,
      linea: r.linea,
      ventaId: r.ventaId,
      cargaId: r.cargaId,
      importe: aImporte(r.importe),
      unidades: aCantidad(r.cantidad),
      negocioId: usuario.negocioId,
    }));
    try {
      await tx.insert(liquidacionRenglones).values(renglonesInsertar);
    } catch (e: any) {
      if (
        e?.code === '23505' ||
        e?.constraint?.includes('liquidacion_renglones') ||
        e?.message?.includes('liquidacion_renglones')
      ) {
        throw conflicto('Uno o más renglones de venta ya fue incluido en otra liquidación.');
      }
      throw e;
    }

    // Insertar conceptos
    const conceptosInsertar = b.conceptos.map((c, idx) => ({
      liquidacionId,
      linea: idx + 1,
      tipo: c.tipo,
      concepto: c.concepto.trim(),
      monto: aImporte(c.monto),
      negocioId: usuario.negocioId,
    }));
    if (conceptosInsertar.length > 0) {
      await tx.insert(liquidacionConceptos).values(conceptosInsertar);
    }

    await registrarAuditoria(
      tx,
      usuario,
      'liquidaciones',
      `${usuario.nombre} emitió el corte ${folioLiquidacion(folio)} para ${prov.nombre} por neto de ${formatoMXN(neto)}`,
      {
        tabla: 'liquidaciones',
        registroId: liquidacionId,
        despues: { folio, totalVendido, comisionFinal, neto },
      },
    );

    const liqMapeada = mapa.liquidacion(
      liq,
      renglonesInsertar.map((r) => ({
        liquidacionId,
        linea: r.linea,
        ventaId: r.ventaId,
        cargaId: r.cargaId,
        importe: r.importe,
        unidades: r.unidades,
      })),
      conceptosInsertar.map((c) => ({
        liquidacionId,
        linea: c.linea,
        tipo: c.tipo,
        concepto: c.concepto,
        monto: c.monto,
      })),
    );

    return {
      ...liqMapeada,
      liquidacion: liqMapeada,
      renglones: liqMapeada.renglones,
      conceptos: liqMapeada.conceptos,
    };
  }),
);

// ── POST /ajustes-productor ──────────────────────────────────────────────────
const esquemaAjuste = z.object({
  proveedorId: z.uuid(),
  tipo: z.enum(['cargo', 'abono']),
  categoria: z.enum(['cancelacion', 'incobrable', 'otro']),
  concepto: z.string().trim().min(1, 'Indica el concepto del ajuste.').max(200),
  monto: decimal,
  ventaId: z.uuid().nullable().optional(),
});

rutasLiquidaciones.post(
  '/ajustes-productor',
  rutaNegocio('liquidaciones.gestionar', async ({ tx, usuario, req }) => {
    const b = esquemaAjuste.parse(req.body);
    const [prov] = await tx.select().from(proveedores).where(eq(proveedores.id, b.proveedorId));
    if (!prov) throw noEncontrado('El productor no existe.');
    if (prov.tipo === 'rancho_propio') throw conflicto('Los ranchos propios no tienen cuenta por pagar ni ajustes.');

    const monto = aImporte(b.monto);
    if (D(monto).lte(0)) throw new ErrorHttp(422, 'El monto debe ser mayor a cero.', 'monto_invalido');

    const id = crypto.randomUUID();
    const ahora = new Date();

    const [ajuste] = await tx
      .insert(ajustesProductor)
      .values({
        id,
        negocioId: usuario.negocioId,
        proveedorId: b.proveedorId,
        tipo: b.tipo,
        categoria: b.categoria,
        concepto: b.concepto,
        monto,
        ventaId: b.ventaId ?? null,
        usuarioId: usuario.id,
        usuarioNombre: usuario.nombre,
        creadoEn: ahora,
      })
      .returning();

    await registrarAuditoria(
      tx,
      usuario,
      'liquidaciones',
      `${usuario.nombre} registró un ${b.tipo} de ${formatoMXN(monto)} a ${prov.nombre} (${b.concepto})`,
      {
        tabla: 'ajustes_productor',
        registroId: id,
        despues: { proveedorId: b.proveedorId, tipo: b.tipo, monto },
      },
    );

    return mapa.ajusteProductor(ajuste);
  }),
);

// ── GET /proveedores/:id/estado-cuenta ───────────────────────────────────────
rutasLiquidaciones.get(
  '/proveedores/:id/estado-cuenta',
  rutaNegocio('liquidaciones.ver', async ({ tx, usuario, req }) => {
    const proveedorId = z.uuid().parse(req.params.id);
    const [prov] = await tx.select().from(proveedores).where(eq(proveedores.id, proveedorId));
    if (!prov) throw noEncontrado('El productor no existe.');

    if (prov.tipo === 'rancho_propio') {
      return {
        proveedor: { id: prov.id, nombre: prov.nombre, tipo: prov.tipo },
        saldo: '0.00',
        totalLiquidado: '0.00',
        totalPagos: '0.00',
        totalAnticipos: '0.00',
        totalCargos: '0.00',
        totalAbonos: '0.00',
        items: [],
      };
    }

    // Cortes
    const cortes = await tx
      .select()
      .from(liquidaciones)
      .where(and(eq(liquidaciones.negocioId, usuario.negocioId), eq(liquidaciones.proveedorId, proveedorId)))
      .orderBy(asc(liquidaciones.creadoEn));

    // Pagos y anticipos
    const pagosMovimientos = await tx
      .select()
      .from(movimientosDinero)
      .where(
        and(
          eq(movimientosDinero.negocioId, usuario.negocioId),
          eq(movimientosDinero.proveedorId, proveedorId),
          inArray(movimientosDinero.categoria, ['pago_proveedor', 'anticipo_productor']),
        ),
      )
      .orderBy(asc(movimientosDinero.creadoEn));

    // Ajustes
    const ajustes = await tx
      .select()
      .from(ajustesProductor)
      .where(and(eq(ajustesProductor.negocioId, usuario.negocioId), eq(ajustesProductor.proveedorId, proveedorId)))
      .orderBy(asc(ajustesProductor.creadoEn));

    // Aplicar pagos acumulados cronológicamente a los cortes más antiguos (§7)
    let fondoParaCortes = sumar(pagosMovimientos.map((p) => D(p.monto)));
    const estadoPorCorte = new Map<string, { estado: 'pendiente' | 'parcial' | 'pagado'; pagado: string; pendiente: string }>();

    for (const c of cortes) {
      const netoCorte = D(c.neto);
      if (fondoParaCortes.gte(netoCorte)) {
        estadoPorCorte.set(c.id, { estado: 'pagado', pagado: aImporte(netoCorte), pendiente: '0.00' });
        fondoParaCortes = fondoParaCortes.minus(netoCorte);
      } else if (fondoParaCortes.gt(0)) {
        estadoPorCorte.set(c.id, {
          estado: 'parcial',
          pagado: aImporte(fondoParaCortes),
          pendiente: aImporte(netoCorte.minus(fondoParaCortes)),
        });
        fondoParaCortes = D(0);
      } else {
        estadoPorCorte.set(c.id, { estado: 'pendiente', pagado: '0.00', pendiente: aImporte(netoCorte) });
      }
    }

    // Unificar todos los eventos cronológicamente para calcular el saldo corrido
    interface EventoTimeline {
      id: string;
      fecha: Date;
      tipo: 'corte' | 'pago' | 'anticipo' | 'cargo' | 'abono';
      concepto: string;
      monto: string;
      signo: '+' | '−';
      deltaSaldo: ReturnType<typeof D>;
      folio?: number;
      estadoCorte?: 'pendiente' | 'parcial' | 'pagado';
      montoPagadoCorte?: string;
      montoPendienteCorte?: string;
      usuarioNombre: string;
    }

    const eventos: EventoTimeline[] = [];

    for (const c of cortes) {
      const ec = estadoPorCorte.get(c.id);
      eventos.push({
        id: c.id,
        fecha: c.creadoEn,
        tipo: 'corte',
        concepto: `Corte de cuenta ${folioLiquidacion(c.folio)}`,
        monto: c.neto,
        signo: '+',
        deltaSaldo: D(c.neto),
        folio: c.folio,
        estadoCorte: ec?.estado,
        montoPagadoCorte: ec?.pagado,
        montoPendienteCorte: ec?.pendiente,
        usuarioNombre: c.usuarioNombre,
      });
    }

    for (const p of pagosMovimientos) {
      const esAnticipo = p.categoria === 'anticipo_productor';
      eventos.push({
        id: p.id,
        fecha: p.creadoEn,
        tipo: esAnticipo ? 'anticipo' : 'pago',
        concepto: p.concepto,
        monto: p.monto,
        signo: '−',
        deltaSaldo: D(p.monto).neg(),
        usuarioNombre: p.usuarioNombre,
      });
    }

    for (const a of ajustes) {
      const esCargo = a.tipo === 'cargo';
      eventos.push({
        id: a.id,
        fecha: a.creadoEn,
        tipo: a.tipo,
        concepto: `Ajuste (${a.categoria}): ${a.concepto}`,
        monto: a.monto,
        signo: esCargo ? '−' : '+',
        deltaSaldo: esCargo ? D(a.monto).neg() : D(a.monto),
        usuarioNombre: a.usuarioNombre,
      });
    }

    eventos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

    let saldoCorrido = D(0);
    const items = eventos.map((ev) => {
      saldoCorrido = saldoCorrido.plus(ev.deltaSaldo);
      return {
        id: ev.id,
        fecha: ev.fecha.toISOString(),
        tipo: ev.tipo,
        concepto: ev.concepto,
        monto: ev.monto,
        cargo: ev.tipo === 'cargo' ? ev.monto : undefined,
        abono: ev.tipo === 'abono' ? ev.monto : undefined,
        signo: ev.signo,
        saldo: aImporte(saldoCorrido),
        folio: ev.folio,
        estadoCorte: ev.estadoCorte,
        montoPagadoCorte: ev.montoPagadoCorte,
        montoPendienteCorte: ev.montoPendienteCorte,
        usuarioNombre: ev.usuarioNombre,
      };
    });

    const totalLiquidado = aImporte(sumar(cortes.map((c) => D(c.neto))));
    const totalPagos = aImporte(sumar(pagosMovimientos.filter((p) => p.categoria === 'pago_proveedor').map((p) => D(p.monto))));
    const totalAnticipos = aImporte(sumar(pagosMovimientos.filter((p) => p.categoria === 'anticipo_productor').map((p) => D(p.monto))));
    const totalCargos = aImporte(sumar(ajustes.filter((a) => a.tipo === 'cargo').map((a) => D(a.monto))));
    const totalAbonos = aImporte(sumar(ajustes.filter((a) => a.tipo === 'abono').map((a) => D(a.monto))));

    const cortesRet = cortes.map((c) => {
      const ec = estadoPorCorte.get(c.id);
      return {
        id: c.id,
        liquidacion: c,
        folio: c.folio,
        neto: c.neto,
        estado: ec?.estado ?? 'pendiente',
        montoCubierto: ec?.pagado ?? '0.00',
        montoPendiente: ec?.pendiente ?? c.neto,
        pagado: ec?.pagado ?? '0.00',
        pendiente: ec?.pendiente ?? c.neto,
      };
    });

    return {
      proveedor: {
        id: prov.id,
        nombre: prov.nombre,
        tipo: prov.tipo,
        comisionTipo: prov.comisionTipo,
        comisionValor: prov.comisionValor,
      },
      saldo: aImporte(saldoCorrido),
      totalLiquidado,
      totalPagos,
      totalAnticipos,
      totalCargos,
      totalAbonos,
      items,
      movimientos: items,
      cortes: cortesRet,
    };
  }),
);

// ── GET /proveedores/saldos ──────────────────────────────────────────────────
rutasLiquidaciones.get(
  '/proveedores/saldos',
  rutaNegocio('liquidaciones.ver', async ({ tx, usuario }) => {
    const provs = await tx
      .select()
      .from(proveedores)
      .where(and(eq(proveedores.negocioId, usuario.negocioId), isNull(proveedores.archivadoEn)))
      .orderBy(asc(proveedores.nombre));

    const saldos = [];
    for (const p of provs) {
      if (p.tipo === 'rancho_propio') {
        saldos.push({
          proveedorId: p.id,
          nombre: p.nombre,
          tipo: p.tipo,
          saldo: '0.00',
          porPagar: '0.00',
          saldoAFavorComerciante: '0.00',
        });
        continue;
      }

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

      const netos = D(rLiq[0]?.total ?? 0);
      const abonos = D(rAjuste[0]?.abonos ?? 0);
      const cargos = D(rAjuste[0]?.cargos ?? 0);
      const pagos = D(rDinero[0]?.pagos ?? 0);
      const anticipos = D(rDinero[0]?.anticipos ?? 0);

      // Saldo derivado: neto + abonos - cargos - pagos - anticipos
      const saldo = netos.plus(abonos).minus(cargos).minus(pagos).minus(anticipos);
      const saldoStr = aImporte(saldo);

      saldos.push({
        proveedorId: p.id,
        nombre: p.nombre,
        tipo: p.tipo,
        saldo: saldoStr,
        porPagar: saldo.gt(0) ? saldoStr : '0.00',
        saldoAFavorComerciante: saldo.lt(0) ? aImporte(saldo.abs()) : '0.00',
      });
    }

    return saldos;
  }),
);

// ── PATCH /cargas/:id/comision ───────────────────────────────────────────────
const esquemaComisionCarga = z.object({
  comisionTipo: z.enum(['porcentaje', 'por_unidad']).nullable(),
  comisionValor: decimal.nullable(),
});

rutasLiquidaciones.patch(
  '/cargas/:id/comision',
  rutaNegocio('cargas.registrar', async ({ tx, usuario, req }) => {
    const cargaId = z.uuid().parse(req.params.id);
    const b = esquemaComisionCarga.parse(req.body);

    const [c] = await tx.select().from(cargas).where(and(eq(cargas.id, cargaId), eq(cargas.negocioId, usuario.negocioId))).for('update');
    if (!c) throw noEncontrado('La carga no existe.');

    // Verificar si algún renglón ya está cortado
    const [cortado] = await tx
      .select({ id: liquidacionRenglones.liquidacionId })
      .from(liquidacionRenglones)
      .where(and(eq(liquidacionRenglones.negocioId, usuario.negocioId), eq(liquidacionRenglones.cargaId, cargaId)))
      .limit(1);

    if (cortado) {
      throw conflicto('La carga ya tiene ventas incluidas en un corte y su comisión no puede modificarse.');
    }

    await tx
      .update(cargas)
      .set({
        comisionTipo: b.comisionTipo,
        comisionValor: b.comisionValor ? aImporte(b.comisionValor) : null,
      })
      .where(eq(cargas.id, cargaId));

    await registrarAuditoria(tx, usuario, 'cargas', `${usuario.nombre} actualizó la comisión de la carga ${c.fecha}`, {
      tabla: 'cargas',
      registroId: cargaId,
      antes: { comisionTipo: c.comisionTipo, comisionValor: c.comisionValor },
      despues: { comisionTipo: b.comisionTipo, comisionValor: b.comisionValor },
    });

    return { ok: true };
  }),
);
