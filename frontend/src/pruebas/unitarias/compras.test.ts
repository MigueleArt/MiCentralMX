import { describe, expect, it } from 'vitest';
import type { Compra } from '@micentralmx/shared/entidades';
import { filtrarOrdenarCompras, resumenCompras, type CompraVistaLista } from '../../dominio/compras';

const compra = ({
  id,
  proveedor,
  total,
  fecha,
  formaPago = 'contado',
  venceEl = null,
  producto = 'Jitomate',
}: {
  id: string;
  proveedor: string;
  total: string;
  fecha: string;
  formaPago?: Compra['formaPago'];
  venceEl?: string | null;
  producto?: string;
}): CompraVistaLista => ({
  sync: null,
  c: {
    id,
    folio: Number(id),
    folioProvisional: null,
    proveedorId: `p-${id}`,
    proveedorNombre: proveedor,
    total,
    formaPago,
    venceEl,
    usuarioId: 'u-1',
    usuarioNombre: 'Rodolfo',
    creadoEnDispositivo: fecha,
    renglones: [{
      clasificacionId: `c-${id}`,
      productoId: `pr-${id}`,
      productoNombre: producto,
      clasificacionNombre: 'Primera',
      unidadNombre: 'caja',
      unidadPlural: 'cajas',
      cantidad: '2',
      costo: '100.00',
      importe: total,
    }],
  },
});

const compras = [
  compra({ id: '1', proveedor: 'Agrícola San Juan', total: '500', fecha: '2026-11-19T12:00:00.000Z' }),
  compra({ id: '2', proveedor: 'Cítricos del Golfo', total: '1200', fecha: '2026-11-17T12:00:00.000Z', formaPago: 'credito', venceEl: '2026-11-18', producto: 'Limón' }),
  compra({ id: '3', proveedor: 'Rancho Norte', total: '800', fecha: '2026-10-01T12:00:00.000Z', formaPago: 'credito', venceEl: '2026-12-01' }),
];

describe('historial de compras', () => {
  it('busca proveedor o producto sin distinguir acentos', () => {
    expect(filtrarOrdenarCompras(compras, 'citricos', 'todas', 'todas', 'recientes', '2026-11-19').map(({ c }) => c.id)).toEqual(['2']);
    expect(filtrarOrdenarCompras(compras, 'limon', 'todas', 'todas', 'recientes', '2026-11-19').map(({ c }) => c.id)).toEqual(['2']);
  });

  it('filtra créditos vencidos y ordena por monto', () => {
    expect(filtrarOrdenarCompras(compras, '', 'todas', 'vencidas', 'monto', '2026-11-19').map(({ c }) => c.id)).toEqual(['2']);
  });

  it('calcula indicadores por día, semana y crédito', () => {
    const resumen = resumenCompras(compras, '2026-11-19');
    expect(resumen.hoy).toBe(1);
    expect(resumen.totalHoy.toString()).toBe('500');
    expect(resumen.semana).toBe(2);
    expect(resumen.totalSemana.toString()).toBe('1700');
    expect(resumen.credito).toBe(2);
    expect(resumen.vencidas).toBe(1);
  });
});
