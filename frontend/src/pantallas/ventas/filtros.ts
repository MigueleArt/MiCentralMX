import type { EstadoVenta } from '@micentralmx/shared/entidades';
import type { VentaVista } from '../../dominio/consultas';
import { diaLocal, sumarDias } from '../../lib/fechas';
import { coincide } from '../../componentes/Formulario';
import { folioVenta } from '../../dominio/formato';

export type Periodo = 'hoy' | 'ayer' | 'semana' | 'todas' | 'rango';

export interface FiltrosVenta {
  periodo: Periodo;
  desde: string;
  hasta: string;
  estado: EstadoVenta | null;
  tipo: 'contado' | 'credito' | null;
  clienteId: string | null;
  sinSincronizar: boolean;
}

export const FILTROS_INICIALES: FiltrosVenta = {
  periodo: 'hoy',
  desde: diaLocal(),
  hasta: diaLocal(),
  estado: null,
  tipo: null,
  clienteId: null,
  sinSincronizar: false,
};

function rango(f: FiltrosVenta): [string, string] | null {
  const hoy = diaLocal();
  switch (f.periodo) {
    case 'hoy':
      return [hoy, hoy];
    case 'ayer':
      return [sumarDias(hoy, -1), sumarDias(hoy, -1)];
    case 'semana':
      return [sumarDias(hoy, -6), hoy];
    case 'rango':
      return [f.desde, f.hasta];
    case 'todas':
      return null;
  }
}

export function filtrarVentas(ventas: VentaVista[], f: FiltrosVenta, busqueda: string): VentaVista[] {
  const r = rango(f);
  return ventas.filter((v) => {
    const dia = diaLocal(v.venta.creadoEnDispositivo);
    if (r && (dia < r[0] || dia > r[1])) return false;
    if (f.estado && v.estado !== f.estado) return false;
    if (f.tipo === 'credito' && v.venta.formaPago !== 'credito') return false;
    if (f.tipo === 'contado' && v.venta.formaPago === 'credito') return false;
    if (f.clienteId && v.venta.clienteId !== f.clienteId) return false;
    if (f.sinSincronizar && !(v.sync === 'pendiente' || v.sync === 'enviando')) return false;
    if (busqueda.trim()) {
      const texto = `${folioVenta(v.venta)} ${v.venta.folio ?? ''} ${v.venta.clienteNombre ?? 'mostrador'} ${dia.split('-').reverse().join('/')}`;
      if (!coincide(texto, busqueda)) return false;
    }
    return true;
  });
}

export const filtrosActivos = (f: FiltrosVenta) =>
  [f.periodo !== 'hoy', f.estado, f.tipo, f.clienteId, f.sinSincronizar].filter(Boolean).length;

/** Chip rápido seleccionado según los filtros. */
export type ChipVenta = 'hoy' | 'todas' | 'credito' | 'por_confirmar' | 'sin_sync' | 'canceladas' | 'otro';
export function chipActivo(f: FiltrosVenta): ChipVenta {
  const sinExtras = !f.clienteId;
  if (f.sinSincronizar && f.periodo === 'todas' && !f.estado && !f.tipo && sinExtras) return 'sin_sync';
  if (f.sinSincronizar) return 'otro';
  if (f.periodo === 'hoy' && !f.estado && !f.tipo && sinExtras) return 'hoy';
  if (f.periodo === 'todas' && !f.estado && !f.tipo && sinExtras) return 'todas';
  if (f.periodo === 'todas' && !f.estado && f.tipo === 'credito' && sinExtras) return 'credito';
  if (f.periodo === 'todas' && f.estado === 'por_confirmar' && !f.tipo && sinExtras) return 'por_confirmar';
  if (f.periodo === 'todas' && f.estado === 'cancelada' && !f.tipo && sinExtras) return 'canceladas';
  return 'otro';
}

export function filtrosDeChip(c: ChipVenta): FiltrosVenta {
  const base = { ...FILTROS_INICIALES, periodo: 'todas' as Periodo };
  switch (c) {
    case 'hoy':
      return FILTROS_INICIALES;
    case 'credito':
      return { ...base, tipo: 'credito' };
    case 'por_confirmar':
      return { ...base, estado: 'por_confirmar' };
    case 'canceladas':
      return { ...base, estado: 'cancelada' };
    case 'sin_sync':
      return { ...base, sinSincronizar: true };
    default:
      return base;
  }
}
