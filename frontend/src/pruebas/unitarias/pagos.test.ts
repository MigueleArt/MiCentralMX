import { describe, expect, it } from 'vitest';
import { generarPagosXlsx } from '../../dominio/exportarExcel';
import {
  agruparMovimientosPorDia,
  chipPagoActivo,
  contarFiltrosPagosActivos,
  crearFiltrosPagosIniciales,
  etiquetaPeriodoPagos,
  filtrarMovimientosPago,
  filtrosDesdeChipPago,
  resumenMovimientosPago,
  textoComprobanteMovimiento,
  type MovimientoPagoVista,
} from '../../pantallas/pagos/filtros';

const HOY = '2026-11-19';

const MOVIMIENTOS: MovimientoPagoVista[] = [
  {
    id: 'm1',
    origen: 'pago',
    tipo: 'ingreso',
    icono: 'cobro',
    categoria: 'cobro_cliente',
    categoriaNombre: 'Cobro a cliente',
    titulo: 'Pago de cliente · Abarrotes Doña Lupe',
    subtitulo: 'Efectivo · Deuda #000127',
    monto: '1000.00',
    metodo: 'efectivo',
    fecha: '2026-11-19T14:30:00.000Z',
    dia: '2026-11-19',
    usuarioNombre: 'Carlos López',
    nota: 'Anticipo semanal',
    excedente: null,
    requiereRevision: false,
    clienteId: 'cli-1',
    clienteNombre: 'Abarrotes Doña Lupe',
    proveedorId: null,
    proveedorNombre: null,
    aplicaciones: [{ ventaId: 'v-127', folio: '#000127', monto: '1000.00' }],
    sync: 'sincronizada',
  },
  {
    id: 'm2',
    origen: 'dinero',
    tipo: 'egreso',
    icono: 'egreso',
    categoria: 'pago_proveedor',
    categoriaNombre: 'Pago a proveedor',
    titulo: 'Pago a proveedor · Agrícola San Juan',
    subtitulo: 'Transferencia',
    monto: '4000.00',
    metodo: 'transferencia',
    fecha: '2026-11-18T16:15:00.000Z',
    dia: '2026-11-18',
    usuarioNombre: 'Rodolfo Hernández',
    nota: null,
    excedente: null,
    requiereRevision: false,
    clienteId: null,
    clienteNombre: null,
    proveedorId: 'prov-1',
    proveedorNombre: 'Agrícola San Juan',
    aplicaciones: [],
    sync: 'pendiente',
  },
  {
    id: 'm3',
    origen: 'dinero',
    tipo: 'ingreso',
    icono: 'ingreso',
    categoria: 'renta',
    categoriaNombre: 'Renta',
    titulo: 'Ingreso · Renta de diablitos',
    subtitulo: 'Efectivo',
    monto: '300.00',
    metodo: 'efectivo',
    fecha: '2026-11-14T18:00:00.000Z',
    dia: '2026-11-14',
    usuarioNombre: 'Ana Hernández',
    nota: null,
    excedente: null,
    requiereRevision: false,
    clienteId: null,
    clienteNombre: null,
    proveedorId: null,
    proveedorNombre: null,
    aplicaciones: [],
    sync: 'sincronizada',
  },
  {
    id: 'm4',
    origen: 'dinero',
    tipo: 'egreso',
    icono: 'egreso',
    categoria: 'flete',
    categoriaNombre: 'Flete de mercancía',
    titulo: 'Flete de mercancía',
    subtitulo: 'Otro',
    monto: '800.00',
    metodo: 'otro',
    fecha: '2026-10-28T15:00:00.000Z',
    dia: '2026-10-28',
    usuarioNombre: 'Rodolfo Hernández',
    nota: 'Viaje nocturno',
    excedente: null,
    requiereRevision: false,
    clienteId: null,
    clienteNombre: null,
    proveedorId: null,
    proveedorNombre: null,
    aplicaciones: [],
    sync: null,
  },
];

describe('pagos: filtros, búsqueda, resúmenes, agrupación y Excel', () => {
  it('busca multi-término sin acentos por cliente, proveedor, folio, nota y usuario', () => {
    const base = crearFiltrosPagosIniciales(HOY);
    expect(filtrarMovimientosPago(MOVIMIENTOS, base, 'dona lupe anticipo', HOY).map((m) => m.id)).toEqual(['m1']);
    expect(filtrarMovimientosPago(MOVIMIENTOS, base, '000127', HOY).map((m) => m.id)).toEqual(['m1']);
    expect(filtrarMovimientosPago(MOVIMIENTOS, base, 'agricola rodolfo', HOY).map((m) => m.id)).toEqual(['m2']);
    expect(filtrarMovimientosPago(MOVIMIENTOS, base, 'nocturno', HOY).map((m) => m.id)).toEqual(['m4']);
    expect(filtrarMovimientosPago(MOVIMIENTOS, base, 'inexistente', HOY)).toEqual([]);
  });

  it('filtra por tipo, periodo, método, categoría y pendientes de sincronización', () => {
    const base = crearFiltrosPagosIniciales(HOY);
    expect(filtrarMovimientosPago(MOVIMIENTOS, { ...base, tipo: 'ingreso' }, '', HOY).map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(filtrarMovimientosPago(MOVIMIENTOS, { ...base, tipo: 'egreso' }, '', HOY).map((m) => m.id)).toEqual(['m2', 'm4']);
    expect(filtrarMovimientosPago(MOVIMIENTOS, { ...base, periodo: 'hoy' }, '', HOY).map((m) => m.id)).toEqual(['m1']);
    expect(filtrarMovimientosPago(MOVIMIENTOS, { ...base, periodo: 'ayer' }, '', HOY).map((m) => m.id)).toEqual(['m2']);
    expect(filtrarMovimientosPago(MOVIMIENTOS, { ...base, periodo: 'semana' }, '', HOY).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(filtrarMovimientosPago(MOVIMIENTOS, { ...base, periodo: 'mes' }, '', HOY).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(
      filtrarMovimientosPago(MOVIMIENTOS, { ...base, periodo: 'rango', desde: '2026-11-18', hasta: '2026-11-14' }, '', HOY).map((m) => m.id),
    ).toEqual(['m2', 'm3']);
    expect(filtrarMovimientosPago(MOVIMIENTOS, { ...base, metodo: 'efectivo' }, '', HOY).map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(filtrarMovimientosPago(MOVIMIENTOS, { ...base, categoria: 'pago_proveedor' }, '', HOY).map((m) => m.id)).toEqual(['m2']);
    expect(filtrarMovimientosPago(MOVIMIENTOS, { ...base, sinSincronizar: true }, '', HOY).map((m) => m.id)).toEqual(['m2']);
  });

  it('ordena por fecha y por monto ascendente o descendente', () => {
    const base = crearFiltrosPagosIniciales(HOY);
    expect(filtrarMovimientosPago(MOVIMIENTOS, { ...base, orden: 'antiguos' }, '', HOY).map((m) => m.id)).toEqual([
      'm4',
      'm3',
      'm2',
      'm1',
    ]);
    expect(filtrarMovimientosPago(MOVIMIENTOS, { ...base, orden: 'monto_desc' }, '', HOY).map((m) => m.id)).toEqual([
      'm2',
      'm1',
      'm4',
      'm3',
    ]);
    expect(filtrarMovimientosPago(MOVIMIENTOS, { ...base, orden: 'monto_asc' }, '', HOY).map((m) => m.id)).toEqual([
      'm3',
      'm4',
      'm1',
      'm2',
    ]);
  });

  it('calcula resumen KPI por método y agrupa movimientos por día', () => {
    const res = resumenMovimientosPago(MOVIMIENTOS);
    expect(res.ingresos.toNumber()).toBe(1300);
    expect(res.cantidadIngresos).toBe(2);
    expect(res.egresos.toNumber()).toBe(4800);
    expect(res.cantidadEgresos).toBe(2);
    expect(res.balance.toNumber()).toBe(-3500);
    expect(res.efectivoNeto.toNumber()).toBe(1300);
    expect(res.transferenciaNeto.toNumber()).toBe(-4000);
    expect(res.otroNeto.toNumber()).toBe(-800);

    const grupos = agruparMovimientosPorDia(MOVIMIENTOS, HOY);
    expect(grupos.map((g) => g.etiqueta)).toEqual(['Hoy', 'Ayer', '14/11/2026', '28/10/2026']);
    expect(grupos[0].balance.toNumber()).toBe(1000);
    expect(grupos[1].balance.toNumber()).toBe(-4000);
  });

  it('sincroniza chips rápidos, conteo de filtros activos y texto de comprobante', () => {
    const base = crearFiltrosPagosIniciales(HOY);
    expect(contarFiltrosPagosActivos(base)).toBe(0);
    expect(chipPagoActivo(base)).toBe('todos');

    const cobros = filtrosDesdeChipPago('cobro_cliente', base);
    expect(cobros.categoria).toBe('cobro_cliente');
    expect(chipPagoActivo(cobros)).toBe('cobro_cliente');
    expect(contarFiltrosPagosActivos(cobros)).toBe(1);

    const fPeriodo = { ...base, periodo: 'rango' as const, desde: '2026-11-18', hasta: '2026-11-19' };
    expect(etiquetaPeriodoPagos(fPeriodo)).toBe('18/11/2026 al 19/11/2026');

    const comprobante = textoComprobanteMovimiento(MOVIMIENTOS[0], 'Bodega Hernández');
    expect(comprobante).toContain('Comprobante de ingreso · Bodega Hernández');
    expect(comprobante).toContain('Deudas aplicadas: #000127 ($1,000)');
    expect(comprobante).toContain('Nota: Anticipo semanal');
    expect(comprobante).toContain('Registrado por: Carlos López');
  });

  it('exporta libro .xlsx nativo válido con resumen y movimientos filtrados', () => {
    const lista = filtrarMovimientosPago(MOVIMIENTOS, crearFiltrosPagosIniciales(HOY), '', HOY);
    const resumen = resumenMovimientosPago(lista);
    const xlsx = generarPagosXlsx({
      negocio: 'Bodega Hernández',
      periodoEtiqueta: 'Todo el historial',
      movimientos: lista,
      resumen,
    });

    expect(xlsx[0]).toBe(0x50);
    expect(xlsx[1]).toBe(0x4b);
    expect(xlsx[2]).toBe(0x03);
    expect(xlsx[3]).toBe(0x04);
    const eocdOffset = xlsx.length - 22;
    expect(xlsx[eocdOffset]).toBe(0x50);
    expect(xlsx[eocdOffset + 1]).toBe(0x4b);
    expect(xlsx[eocdOffset + 2]).toBe(0x05);
    expect(xlsx[eocdOffset + 3]).toBe(0x06);

    const textoZip = new TextDecoder().decode(xlsx);
    expect(textoZip).toContain('xl/worksheets/sheet1.xml');
    expect(textoZip).toContain('sheet name="Pagos"');
    expect(textoZip).toContain('Bodega Hernández');
    expect(textoZip).toContain('Abarrotes Doña Lupe');
    expect(textoZip).toContain('Agrícola San Juan');
  });
});
