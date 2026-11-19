import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { PagoLocal, VentaLocal } from '../../db/db';
import type { ClienteVista, VentaVista } from '../../dominio/consultas';
import { agruparDeudasPorCliente, resumenAbonos } from '../../dominio/resumenes';
import {
  montosRapidosAbono,
  textoComprobanteAbono,
  textoEstadoCuentaCliente,
} from '../../pantallas/deudas/comprobantes';

function deudaMock(opts: {
  id: string;
  folio: number;
  clienteId: string;
  clienteNombre: string;
  total: string;
  pagado: string;
  saldo: string;
  deuda: 'vencida' | 'proxima' | 'pendiente' | 'pagada';
  venceEl: string | null;
}): VentaVista {
  const venta: VentaLocal = {
    id: opts.id,
    folio: opts.folio,
    folioProvisional: null,
    clienteId: opts.clienteId,
    clienteNombre: opts.clienteNombre,
    formaPago: 'credito',
    estado: opts.deuda === 'pagada' ? 'completada' : 'a_credito',
    renglones: [],
    total: opts.total,
    pagado: opts.pagado,
    venceEl: opts.venceEl,
    usuarioId: 'u1',
    usuarioNombre: 'Ana',
    dispositivoId: 'd1',
    creadoEnDispositivo: '2026-11-01T10:00:00-06:00',
    requiereRevision: false,
    motivoRevision: null,
    canceladaEn: null,
  };
  return {
    venta,
    folio: `#${String(opts.folio).padStart(6, '0')}`,
    pagado: new Decimal(opts.pagado),
    saldo: new Decimal(opts.saldo),
    estado: venta.estado,
    sync: null,
    motivoSync: null,
    requiereRevision: false,
    deuda: opts.deuda,
  };
}

function pagoMock(opts: {
  id: string;
  clienteId: string;
  clienteNombre: string;
  monto: string;
  fecha: string;
  operacionId?: string;
}): PagoLocal {
  return {
    id: opts.id,
    clienteId: opts.clienteId,
    clienteNombre: opts.clienteNombre,
    monto: opts.monto,
    metodo: 'efectivo',
    nota: 'Abono parcial',
    aplicaciones: [],
    excedente: '0.00',
    usuarioId: 'u1',
    usuarioNombre: 'Ana',
    creadoEnDispositivo: opts.fecha,
    requiereRevision: false,
    operacionId: opts.operacionId,
  };
}

describe('Control sencillo de abonos y deudas', () => {
  it('calcula abonos de hoy y del mes ignorando operaciones rechazadas', () => {
    const pagos: PagoLocal[] = [
      pagoMock({ id: 'p1', clienteId: 'c1', clienteNombre: 'Juan', monto: '500.00', fecha: '2026-11-18T10:00:00-06:00' }),
      pagoMock({ id: 'p2', clienteId: 'c2', clienteNombre: 'Lupe', monto: '300.00', fecha: '2026-11-10T10:00:00-06:00' }),
      pagoMock({ id: 'p3', clienteId: 'c2', clienteNombre: 'Lupe', monto: '999.00', fecha: '2026-11-18T11:00:00-06:00', operacionId: 'op-rej' }),
    ];
    const res = resumenAbonos(pagos, new Set(['op-rej']), '2026-11-18');
    expect(res.abonadoHoy.toString()).toBe('500');
    expect(res.cantidadHoy).toBe(1);
    expect(res.abonadoMes.toString()).toBe('800');
    expect(res.cantidadMes).toBe(2);
    expect(res.recientes.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('agrupa deudas abiertas por cliente ordenando primero clientes con deudas vencidas', () => {
    const d1 = deudaMock({ id: 'v1', folio: 101, clienteId: 'c1', clienteNombre: 'Juan Pérez', total: '1000.00', pagado: '200.00', saldo: '800.00', deuda: 'pendiente', venceEl: '2026-11-30' });
    const d2 = deudaMock({ id: 'v2', folio: 102, clienteId: 'c1', clienteNombre: 'Juan Pérez', total: '500.00', pagado: '0.00', saldo: '500.00', deuda: 'proxima', venceEl: '2026-11-20' });
    const d3 = deudaMock({ id: 'v3', folio: 103, clienteId: 'c2', clienteNombre: 'Fonda El Comal', total: '600.00', pagado: '0.00', saldo: '600.00', deuda: 'vencida', venceEl: '2026-11-10' });
    const d4 = deudaMock({ id: 'v4', folio: 104, clienteId: 'c3', clienteNombre: 'Pagado', total: '400.00', pagado: '400.00', saldo: '0.00', deuda: 'pagada', venceEl: '2026-11-12' });

    const clientes: ClienteVista[] = [
      { cliente: { id: 'c1', nombre: 'Juan Pérez', telefono: '5511', ubicacion: null, plazoDias: 7, saldoAFavor: '0', creadoEn: '', archivadoEn: null, requiereRevision: false }, saldo: new Decimal(1300), estado: 'proxima', deudasAbiertas: [d2, d1], ultimaCompra: null, sync: null },
      { cliente: { id: 'c2', nombre: 'Fonda El Comal', telefono: null, ubicacion: null, plazoDias: 7, saldoAFavor: '0', creadoEn: '', archivadoEn: null, requiereRevision: false }, saldo: new Decimal(600), estado: 'vencida', deudasAbiertas: [d3], ultimaCompra: null, sync: null },
    ];
    const pagos = [pagoMock({ id: 'p1', clienteId: 'c1', clienteNombre: 'Juan Pérez', monto: '200.00', fecha: '2026-11-15T12:00:00-06:00' })];

    const agrupados = agruparDeudasPorCliente([d1, d2, d3, d4], clientes, pagos);
    expect(agrupados.map((c) => c.clienteId)).toEqual(['c2', 'c1']);
    expect(agrupados[1].saldoTotal.toString()).toBe('1300');
    expect(agrupados[1].cantidadDeudas).toBe(2);
    expect(agrupados[1].ultimoAbono?.monto).toBe('200.00');
  });

  it('genera atajos de monto sin duplicados y arma textos de comprobante y estado de cuenta', () => {
    const atajos = montosRapidosAbono(new Decimal('1200'));
    expect(atajos.map((a) => a.monto)).toEqual(['1200', '600', '200', '500', '1000']);
    const atajosChicos = montosRapidosAbono(new Decimal('15'));
    expect(atajosChicos.map((a) => a.monto)).toEqual(['15']);

    const comp = textoComprobanteAbono({
      negocio: 'Bodega Hernández',
      clienteNombre: 'Juan Pérez',
      monto: '500',
      metodo: 'efectivo',
      fecha: '2026-11-18T14:30:00-06:00',
      saldoAnterior: '1300',
      saldoRestante: '800',
      nota: 'En bodega',
    });
    expect(comp).toContain('Comprobante de abono · Bodega Hernández');
    expect(comp).toContain('Abono recibido: $500 (Efectivo)');
    expect(comp).toContain('Saldo restante: $800');

    const d = deudaMock({ id: 'v1', folio: 98, clienteId: 'c1', clienteNombre: 'Juan Pérez', total: '1000', pagado: '200', saldo: '800', deuda: 'vencida', venceEl: '2026-11-10' });
    const estado = textoEstadoCuentaCliente({
      negocio: 'Bodega Hernández',
      clienteNombre: 'Juan Pérez',
      saldoTotal: '800',
      deudasAbiertas: [d],
    });
    expect(estado).toContain('Venta #000098');
    expect(estado).toContain('Total por pagar: $800');
  });
});
