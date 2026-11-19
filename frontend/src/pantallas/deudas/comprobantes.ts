import Decimal from 'decimal.js';
import type { MetodoPago } from '@micentralmx/shared/entidades';
import type { VentaVista } from '../../dominio/consultas';
import { ETIQUETA_METODO } from '../../dominio/formato';
import { D, formatoMXN } from '../../lib/dinero';
import { formatoDia, formatoFechaHora } from '../../lib/fechas';

export interface OpcionMontoAbono {
  etiqueta: string;
  monto: string;
}

const CANDIDATOS_REDONDOS = [50, 100, 200, 500, 1000, 2000, 5000];

/** Genera atajos útiles de abono adaptados al saldo pendiente sin duplicados. */
export function montosRapidosAbono(saldo: Decimal): OpcionMontoAbono[] {
  if (saldo.lte(0)) return [];
  const opciones: OpcionMontoAbono[] = [];
  const vistos = new Set<string>();

  const agregar = (etiqueta: string, val: Decimal) => {
    const limpio = val.toDecimalPlaces(2);
    const clave = limpio.toFixed(2);
    if (limpio.lte(0) || vistos.has(clave)) return;
    vistos.add(clave);
    opciones.push({ etiqueta, monto: limpio.toString() });
  };

  agregar(`Liquidar ${formatoMXN(saldo)}`, saldo);

  if (saldo.gte(20)) {
    const mitad = saldo.div(2).toDecimalPlaces(2);
    agregar(`Mitad ${formatoMXN(mitad)}`, mitad);
  }

  const redondos = CANDIDATOS_REDONDOS.filter((n) => saldo.gt(n) && !vistos.has(D(n).toFixed(2))).slice(-3);
  for (const n of redondos) {
    agregar(formatoMXN(n), D(n));
  }

  return opciones;
}

export function textoComprobanteAbono({
  negocio,
  clienteNombre,
  monto,
  metodo,
  fecha,
  saldoAnterior,
  saldoRestante,
  nota,
}: {
  negocio: string;
  clienteNombre: string;
  monto: Decimal.Value;
  metodo: MetodoPago;
  fecha: string;
  saldoAnterior?: Decimal.Value | null;
  saldoRestante?: Decimal.Value | null;
  nota?: string | null;
}): string {
  const lineas = [
    `*Comprobante de abono · ${negocio}*`,
    `Cliente: ${clienteNombre}`,
    `Fecha: ${formatoFechaHora(fecha)}`,
    `Abono recibido: ${formatoMXN(monto)} (${ETIQUETA_METODO[metodo]})`,
  ];
  if (saldoAnterior != null) {
    lineas.push(`Saldo anterior: ${formatoMXN(saldoAnterior)}`);
  }
  if (saldoRestante != null) {
    lineas.push(`Saldo restante: ${formatoMXN(Decimal.max(D(saldoRestante), 0))}`);
  }
  if (nota?.trim()) {
    lineas.push(`Nota: ${nota.trim()}`);
  }
  return lineas.join('\n');
}

export function textoEstadoCuentaCliente({
  negocio,
  clienteNombre,
  saldoTotal,
  deudasAbiertas,
}: {
  negocio: string;
  clienteNombre: string;
  saldoTotal: Decimal.Value;
  deudasAbiertas: VentaVista[];
}): string {
  const lineas = [
    `*Estado de cuenta · ${negocio}*`,
    `Cliente: ${clienteNombre}`,
    `Notas pendientes (${deudasAbiertas.length}):`,
  ];
  for (const d of deudasAbiertas) {
    const vence = d.venta.venceEl ? ` (vence ${formatoDia(d.venta.venceEl)})` : '';
    lineas.push(`- Venta ${d.folio}${vence}: ${formatoMXN(d.saldo)}`);
  }
  lineas.push(`*Total por pagar: ${formatoMXN(saldoTotal)}*`);
  return lineas.join('\n');
}

export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Fallback abajo
  }
  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
