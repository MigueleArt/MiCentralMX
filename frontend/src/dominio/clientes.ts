import { D, sumar } from '../lib/dinero';
import type { ClienteVista } from './consultas';

export type FiltroClientes = 'todos' | 'con_saldo' | 'vencida' | 'proxima' | 'al_corriente' | 'sin_saldo';
export type OrdenClientes = 'nombre' | 'saldo_desc' | 'actividad';

export interface DatosClienteFormulario {
  nombre: string;
  telefono: string;
  ubicacion: string;
  plazo: string;
}

export function validarClienteFormulario(datos: DatosClienteFormulario): Record<string, string> {
  const errores: Record<string, string> = {};
  const nombre = datos.nombre.trim();
  const digitos = datos.telefono.replace(/\D/g, '');
  const plazo = datos.plazo ? Number(datos.plazo) : null;
  if (nombre.length < 2) errores.nombre = 'Escribe el nombre o negocio del cliente.';
  else if (nombre.length > 160) errores.nombre = 'El nombre no puede superar 160 caracteres.';
  if (datos.telefono.trim() && digitos.length < 10) errores.telefono = 'El teléfono debe tener al menos 10 dígitos.';
  else if (datos.telefono.trim().length > 30) errores.telefono = 'El teléfono no puede superar 30 caracteres.';
  if (datos.ubicacion.trim().length > 200) errores.ubicacion = 'La ubicación no puede superar 200 caracteres.';
  if (plazo != null && (!Number.isInteger(plazo) || plazo < 1 || plazo > 120)) errores.plazo = 'El plazo debe estar entre 1 y 120 días.';
  return errores;
}

const normalizar = (texto: string) =>
  texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();

export function filtrarOrdenarClientes(
  clientes: ClienteVista[],
  busqueda: string,
  filtro: FiltroClientes,
  orden: OrdenClientes,
): ClienteVista[] {
  const consulta = normalizar(busqueda);
  const resultado = clientes.filter((cliente) => {
    const coincide = !consulta || normalizar([
      cliente.cliente.nombre,
      cliente.cliente.telefono ?? '',
      cliente.cliente.ubicacion ?? '',
    ].join(' ')).includes(consulta);
    if (!coincide) return false;
    if (filtro === 'con_saldo') return cliente.saldo.gt(0);
    if (filtro !== 'todos') return cliente.estado === filtro;
    return true;
  });

  return resultado.sort((a, b) => {
    if (orden === 'saldo_desc') {
      return b.saldo.comparedTo(a.saldo) || a.cliente.nombre.localeCompare(b.cliente.nombre, 'es');
    }
    if (orden === 'actividad') {
      return (b.ultimaCompra ?? '').localeCompare(a.ultimaCompra ?? '') || a.cliente.nombre.localeCompare(b.cliente.nombre, 'es');
    }
    return a.cliente.nombre.localeCompare(b.cliente.nombre, 'es');
  });
}

export function resumenClientes(clientes: ClienteVista[]) {
  const conSaldo = clientes.filter((cliente) => cliente.saldo.gt(0));
  const vencidos = clientes.filter((cliente) => cliente.estado === 'vencida');
  const sinSaldo = clientes.filter((cliente) => cliente.estado === 'sin_saldo');
  return {
    total: clientes.length,
    conSaldo: conSaldo.length,
    saldoTotal: sumar(conSaldo.map((cliente) => cliente.saldo)),
    vencidos: vencidos.length,
    saldoVencido: sumar(vencidos.flatMap((cliente) => cliente.deudasAbiertas.filter((deuda) => deuda.deuda === 'vencida').map((deuda) => deuda.saldo))),
    sinSaldo: sinSaldo.length,
    saldoAFavor: sumar(clientes.map((cliente) => D(cliente.cliente.saldoAFavor))),
  };
}
