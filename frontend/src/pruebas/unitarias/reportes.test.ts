import { describe, expect, it } from 'vitest';
import type { Venta } from '@micentralmx/shared/entidades';
import {
  calcularRangoPeriodo,
  calcularResumenReportes,
  exportarReporteCsv,
  type DatosFuenteReportes,
} from '../../dominio/reportesLocales';
import { generarReporteXlsx } from '../../dominio/exportarExcel';

function crearVentaPrueba(parcial: Partial<Venta> & { id: string; folio: number; total: string; creadoEnDispositivo: string }): Venta {
  return {
    folioProvisional: null,
    clienteId: null,
    clienteNombre: null,
    formaPago: 'efectivo',
    estado: 'completada',
    renglones: [],
    pagado: '0.00',
    venceEl: null,
    usuarioId: 'u1',
    usuarioNombre: 'Rodolfo',
    dispositivoId: 'd1',
    requiereRevision: false,
    motivoRevision: null,
    canceladaEn: null,
    ...parcial,
  };
}

describe('Reportes diario, semanal y mensual', () => {
  it('calcula rangos diario, semanal (lunes a domingo) y mensual con desplazamientos', () => {
    // 2026-11-18 es miércoles
    const hoy = '2026-11-18';
    expect(calcularRangoPeriodo('diario', 0, '', '', hoy)).toEqual({
      desde: '2026-11-18',
      hasta: '2026-11-18',
      granularidad: 'dia',
      titulo: 'Hoy · 18/11/2026',
    });
    expect(calcularRangoPeriodo('diario', -1, '', '', hoy).desde).toBe('2026-11-17');

    const semActual = calcularRangoPeriodo('semanal', 0, '', '', hoy);
    expect(semActual.desde).toBe('2026-11-16');
    expect(semActual.hasta).toBe('2026-11-18');
    expect(semActual.granularidad).toBe('semana');

    const semAnterior = calcularRangoPeriodo('semanal', -1, '', '', hoy);
    expect(semAnterior.desde).toBe('2026-11-09');
    expect(semAnterior.hasta).toBe('2026-11-15');

    const mesActual = calcularRangoPeriodo('mensual', 0, '', '', hoy);
    expect(mesActual.desde).toBe('2026-11-01');
    expect(mesActual.hasta).toBe('2026-11-18');
    expect(mesActual.granularidad).toBe('mes');

    const mesAnterior = calcularRangoPeriodo('mensual', -1, '', '', hoy);
    expect(mesAnterior.desde).toBe('2026-10-01');
    expect(mesAnterior.hasta).toBe('2026-10-31');
  });

  it('separa ventas por forma de pago, incluye contado en ingresos reales y calcula serie y top productos', () => {
    const datos: DatosFuenteReportes = {
      ventas: [
        crearVentaPrueba({
          id: 'v1',
          folio: 1,
          total: '1000.00',
          formaPago: 'efectivo',
          estado: 'completada',
          creadoEnDispositivo: '2026-11-18T09:30:00-06:00',
          renglones: [
            {
              clasificacionId: 'c1',
              productoId: 'p1',
              productoNombre: 'Jitomate Saladette',
              clasificacionNombre: 'Primera / Grande',
              unidadNombre: 'tara',
              unidadPlural: 'taras',
              cantidad: '2',
              precio: '500.00',
              precioReferencia: '500.00',
              importe: '1000.00',
            },
          ],
        }),
        crearVentaPrueba({
          id: 'v2',
          folio: 2,
          total: '600.00',
          formaPago: 'transferencia',
          estado: 'completada',
          creadoEnDispositivo: '2026-11-18T13:15:00-06:00',
          renglones: [
            {
              clasificacionId: 'c2',
              productoId: 'p2',
              productoNombre: 'Aguacate Hass',
              clasificacionNombre: 'Primera',
              unidadNombre: 'caja',
              unidadPlural: 'cajas',
              cantidad: '1',
              precio: '600.00',
              precioReferencia: '600.00',
              importe: '600.00',
            },
          ],
        }),
        crearVentaPrueba({
          id: 'v3',
          folio: 3,
          total: '400.00',
          formaPago: 'transferencia',
          estado: 'por_confirmar',
          creadoEnDispositivo: '2026-11-18T14:00:00-06:00',
        }),
        crearVentaPrueba({
          id: 'v4',
          folio: 4,
          total: '900.00',
          formaPago: 'credito',
          estado: 'a_credito',
          pagado: '200.00',
          clienteId: 'cli1',
          clienteNombre: 'Juan',
          venceEl: '2026-11-25',
          creadoEnDispositivo: '2026-11-18T18:10:00-06:00',
        }),
        crearVentaPrueba({
          id: 'v5',
          folio: 5,
          total: '9999.00',
          formaPago: 'efectivo',
          estado: 'cancelada',
          creadoEnDispositivo: '2026-11-18T10:00:00-06:00',
        }),
        crearVentaPrueba({
          id: 'v-prev',
          folio: 0,
          total: '1500.00',
          formaPago: 'efectivo',
          estado: 'completada',
          creadoEnDispositivo: '2026-11-17T10:00:00-06:00',
        }),
      ],
      compras: [],
      pagos: [
        {
          id: 'pag1',
          clienteId: 'cli1',
          clienteNombre: 'Juan',
          monto: '250.00',
          metodo: 'efectivo',
          nota: null,
          aplicaciones: [{ ventaId: 'v4', monto: '250.00' }],
          excedente: '0.00',
          usuarioId: 'u1',
          usuarioNombre: 'Rodolfo',
          creadoEnDispositivo: '2026-11-18T15:00:00-06:00',
          requiereRevision: false,
        },
      ],
      movimientosDinero: [
        {
          id: 'd1',
          tipo: 'ingreso',
          categoria: 'otro_ingreso',
          concepto: 'Renta',
          monto: '100.00',
          metodo: 'efectivo',
          proveedorId: null,
          usuarioNombre: 'Rodolfo',
          creadoEn: '2026-11-18T11:00:00-06:00',
        },
        {
          id: 'd2',
          tipo: 'egreso',
          categoria: 'flete',
          concepto: 'Flete',
          monto: '300.00',
          metodo: 'efectivo',
          proveedorId: null,
          usuarioNombre: 'Rodolfo',
          creadoEn: '2026-11-18T16:00:00-06:00',
        },
      ],
      movimientosInventario: [],
      productos: [],
      clasificaciones: [],
      existencias: [],
    };

    const rep = calcularResumenReportes(datos, '2026-11-18', '2026-11-18', 'dia', '2026-11-18');
    expect(rep.ventas.total).toBe('2900.00');
    expect(rep.ventas.cantidad).toBe(4);
    expect(rep.ventasDetalle.contadoEfectivo).toBe('1000.00');
    expect(rep.ventasDetalle.contadoTransferencia).toBe('600.00');
    expect(rep.ventasDetalle.transferenciaPorConfirmar).toBe('400.00');
    expect(rep.ventasDetalle.credito).toBe('900.00');
    expect(rep.ventasDetalle.ticketPromedio).toBe('725.00');

    expect(rep.ingresosDetalle.ventasContado).toBe('1600.00');
    expect(rep.ingresosDetalle.abonosDeudas).toBe('250.00');
    expect(rep.ingresosDetalle.otrosIngresos).toBe('100.00');
    expect(rep.ingresosDetalle.totalIngresos).toBe('1950.00');
    expect(rep.ingresosDetalle.egresos).toBe('300.00');
    expect(rep.ingresosDetalle.balanceNeto).toBe('1650.00');

    expect(rep.comparativa.ventasTotal).toBe('1500.00');
    expect(rep.comparativa.ingresosTotal).toBe('1500.00');

    expect(rep.serie).toHaveLength(4);
    expect(rep.serie.map((s) => s.etiqueta)).toEqual(['Madrugada', 'Mañana', 'Tarde', 'Noche']);
    expect(rep.topProductos.map((p) => p.nombre)).toEqual(['Jitomate Saladette', 'Aguacate Hass']);

    const csv = exportarReporteCsv(rep, 'Bodega Hernández');
    expect(csv).toContain('\r\n');
    expect(csv).toContain('Reporte Bodega Hernández');
    expect(csv).toContain('Ventas a crédito,900.00');
    expect(csv).toContain('Ventas totales,2900.00');
    expect(csv).toContain('Ingresos reales totales,1950.00');
    expect(csv).toContain('Productos más vendidos,Clasificación');
    expect(csv).toContain('Jitomate Saladette');

    // En reporte semanal, los días se exportan completos (ej. Martes 17/11/2026) para evitar autoconversión en Excel
    const repSemanal = calcularResumenReportes(datos, '2026-11-16', '2026-11-19', 'semana', '2026-11-19');
    const csvSem = exportarReporteCsv(repSemanal, 'Bodega Hernández');
    expect(csvSem).toContain('Martes 17/11/2026');
    expect(csvSem).not.toContain('Mar 17');

    // Exportador nativo .xlsx (OOXML ZIP)
    const xlsx = generarReporteXlsx(repSemanal, 'Bodega Hernández');
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
    expect(textoZip).toContain('xl/styles.xml');
    expect(textoZip).toContain('&quot;$&quot;#,##0.00');
    expect(textoZip).toContain('<cols>');
    expect(textoZip).toContain('Bodega Hernández');
    expect(textoZip).toContain('Martes 17/11/2026');
    expect(textoZip).toContain('Jitomate Saladette');
  });

  it('genera serie sin huecos de 7 días para semana y bloques semanales para mes', () => {
    const vacio: DatosFuenteReportes = {
      ventas: [],
      compras: [],
      pagos: [],
      movimientosDinero: [],
      movimientosInventario: [],
      productos: [],
      clasificaciones: [],
      existencias: [],
    };
    const semanal = calcularResumenReportes(vacio, '2026-11-09', '2026-11-15', 'semana', '2026-11-18');
    expect(semanal.serie).toHaveLength(7);
    expect(semanal.serie[0].clave).toBe('2026-11-09');
    expect(semanal.serie[6].clave).toBe('2026-11-15');

    const mensual = calcularResumenReportes(vacio, '2026-11-01', '2026-11-30', 'mes', '2026-11-18');
    expect(mensual.serie).toHaveLength(5);
    expect(mensual.serie[0].etiqueta).toBe('Sem 1 (01–07)');
    expect(mensual.serie[4].etiqueta).toBe('Sem 5 (29–30)');
  });
});
