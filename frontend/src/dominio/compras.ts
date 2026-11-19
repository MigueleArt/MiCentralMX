import type { Compra } from '@micentralmx/shared/entidades';
import type { EstadoSync } from '../db/db';
import { sumar } from '../lib/dinero';
import { diaLocal, sumarDias } from '../lib/fechas';

export interface CompraVistaLista {
  c: Compra;
  sync: EstadoSync | null;
}

export type PeriodoCompras = 'hoy' | 'semana' | 'mes' | 'todas';
export type EstadoCompras = 'todas' | 'contado' | 'credito' | 'vencidas';
export type OrdenCompras = 'recientes' | 'monto' | 'proveedor';

const normalizar = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();

export function filtrarOrdenarCompras(
  compras: CompraVistaLista[],
  busqueda: string,
  periodo: PeriodoCompras,
  estado: EstadoCompras,
  orden: OrdenCompras,
  hoy = diaLocal(),
) {
  const desde = periodo === 'hoy' ? hoy : periodo === 'semana' ? sumarDias(hoy, -6) : periodo === 'mes' ? sumarDias(hoy, -29) : '0000';
  const consulta = normalizar(busqueda);
  return compras
    .filter(({ c }) => {
      const texto = normalizar([c.folio ?? c.folioProvisional ?? '', c.proveedorNombre, c.usuarioNombre, ...c.renglones.map((r) => `${r.productoNombre} ${r.clasificacionNombre}`)].join(' '));
      const coincide = !consulta || texto.includes(consulta);
      const enPeriodo = diaLocal(c.creadoEnDispositivo) >= desde;
      const enEstado = estado === 'todas'
        || c.formaPago === estado
        || (estado === 'vencidas' && c.formaPago === 'credito' && !!c.venceEl && c.venceEl < hoy);
      return coincide && enPeriodo && enEstado;
    })
    .sort((a, b) => {
      if (orden === 'monto') return Number(b.c.total) - Number(a.c.total) || b.c.creadoEnDispositivo.localeCompare(a.c.creadoEnDispositivo);
      if (orden === 'proveedor') return a.c.proveedorNombre.localeCompare(b.c.proveedorNombre, 'es') || b.c.creadoEnDispositivo.localeCompare(a.c.creadoEnDispositivo);
      return b.c.creadoEnDispositivo.localeCompare(a.c.creadoEnDispositivo);
    });
}

export function resumenCompras(compras: CompraVistaLista[], hoy = diaLocal()) {
  const delDia = compras.filter(({ c }) => diaLocal(c.creadoEnDispositivo) === hoy);
  const deSemana = compras.filter(({ c }) => diaLocal(c.creadoEnDispositivo) >= sumarDias(hoy, -6));
  const aCredito = compras.filter(({ c }) => c.formaPago === 'credito');
  const vencidas = aCredito.filter(({ c }) => !!c.venceEl && c.venceEl < hoy);
  return {
    hoy: delDia.length,
    totalHoy: sumar(delDia.map(({ c }) => c.total)),
    semana: deSemana.length,
    totalSemana: sumar(deSemana.map(({ c }) => c.total)),
    credito: aCredito.length,
    totalCredito: sumar(aCredito.map(({ c }) => c.total)),
    vencidas: vencidas.length,
    totalVencido: sumar(vencidas.map(({ c }) => c.total)),
  };
}
