import type { MovimientoEnvase } from '@micentralmx/shared/entidades';
import { db, type EstadoSync } from '../db/db';
import { cargarOperaciones, sincronizacionDe } from './consultas';

export type MovimientoEnvaseVista = MovimientoEnvase & { sincronizacion: EstadoSync | null };

export interface SaldoEnvaseCliente {
  clienteId: string;
  clienteNombre: string;
  envase: string;
  saldo: number;
  confirmado: boolean;
  soloRechazados: boolean;
  movimientos: MovimientoEnvaseVista[];
}

const delta = (m: MovimientoEnvase) => {
  if (m.tipo === 'entrega') return Number(m.cantidad);
  if (m.tipo === 'devolucion') return -Number(m.cantidad);
  if (m.tipo === 'ajuste') return m.direccion === 'aumenta' ? Number(m.cantidad) : -Number(m.cantidad);
  return 0;
};

/** Calcula saldos físicos desde el libro de movimientos sin confundirlos con deudas de dinero. */
export async function saldosEnvases(): Promise<SaldoEnvaseCliente[]> {
  const [{ porId, vigentes }, filas, clientes] = await Promise.all([
    cargarOperaciones(),
    db.movimientosEnvase.toArray(),
    db.clientes.toArray(),
  ]);
  const nombres = new Map(clientes.map((c) => [c.id, c.nombre]));
  const grupos = new Map<string, MovimientoEnvaseVista[]>();
  for (const fila of filas) {
    const op = fila.operacionId ? porId.get(fila.operacionId) : undefined;
    if (fila.operacionId && (!op || (op.estado !== 'rechazada' && !vigentes.has(fila.operacionId)))) continue;
    const clave = `${fila.clienteId}:${fila.envase.toLocaleLowerCase()}`;
    const vista = { ...fila, sincronizacion: sincronizacionDe(porId, fila.operacionId) };
    grupos.set(clave, [...(grupos.get(clave) ?? []), vista]);
  }
  return [...grupos.values()].map((movimientos) => {
    movimientos.sort((a, b) => a.creadoEnDispositivo.localeCompare(b.creadoEnDispositivo) || (a.tipo === 'saldo_inicial' ? -1 : 1));
    const aplicables = movimientos.filter((m) => m.sincronizacion !== 'rechazada');
    let ultimoSaldo = -1;
    for (let i = 0; i < aplicables.length; i++) if (aplicables[i].tipo === 'saldo_inicial') ultimoSaldo = i;
    const base = ultimoSaldo >= 0 ? Number(aplicables[ultimoSaldo].cantidad) : 0;
    const saldo = aplicables.slice(ultimoSaldo >= 0 ? ultimoSaldo + 1 : 0).reduce((n, m) => n + delta(m), base);
    const primero = movimientos[0];
    return {
      clienteId: primero.clienteId,
      clienteNombre: nombres.get(primero.clienteId) ?? primero.clienteNombre,
      envase: primero.envase,
      saldo,
      confirmado: ultimoSaldo >= 0,
      soloRechazados: aplicables.length === 0,
      movimientos: [...movimientos].reverse(),
    };
  }).sort((a, b) => b.saldo - a.saldo || a.clienteNombre.localeCompare(b.clienteNombre, 'es'));
}
