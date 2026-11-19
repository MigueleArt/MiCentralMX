import { describe, expect, it } from 'vitest';
import { filtrarOrdenarClientes, resumenClientes, validarClienteFormulario } from '../../dominio/clientes';
import type { ClienteVista, VentaVista } from '../../dominio/consultas';
import { D } from '../../lib/dinero';

const cliente = ({
  id,
  nombre,
  saldo = 0,
  estado = 'sin_saldo',
  telefono = null,
  ubicacion = null,
  ultimaCompra = null,
  vencido = 0,
}: {
  id: string;
  nombre: string;
  saldo?: number;
  estado?: ClienteVista['estado'];
  telefono?: string | null;
  ubicacion?: string | null;
  ultimaCompra?: string | null;
  vencido?: number;
}): ClienteVista => ({
  cliente: {
    id,
    nombre,
    telefono,
    ubicacion,
    plazoDias: null,
    saldoAFavor: '0',
    creadoEn: '2026-01-01T00:00:00.000Z',
    archivadoEn: null,
    requiereRevision: false,
  },
  saldo: D(saldo),
  estado,
  ultimaCompra,
  sync: null,
  deudasAbiertas: vencido > 0 ? [{ deuda: 'vencida', saldo: D(vencido) } as VentaVista] : [],
});

const clientes = [
  cliente({ id: '1', nombre: 'José Pérez', saldo: 900, estado: 'vencida', telefono: '55 1111 2222', ubicacion: 'Nave A', ultimaCompra: '2026-11-10T10:00:00.000Z', vencido: 600 }),
  cliente({ id: '2', nombre: 'Abarrotes Luna', saldo: 300, estado: 'proxima', ubicacion: 'Puesto 18', ultimaCompra: '2026-11-18T10:00:00.000Z' }),
  cliente({ id: '3', nombre: 'Fonda Sol', estado: 'sin_saldo' }),
];

describe('directorio de clientes', () => {
  it('valida los datos compartidos por alta y edición', () => {
    expect(validarClienteFormulario({ nombre: '', telefono: '123', ubicacion: '', plazo: '0' })).toEqual({
      nombre: 'Escribe el nombre o negocio del cliente.',
      telefono: 'El teléfono debe tener al menos 10 dígitos.',
      plazo: 'El plazo debe estar entre 1 y 120 días.',
    });
    expect(validarClienteFormulario({ nombre: 'Cliente válido', telefono: '55 1234 5678', ubicacion: 'Nave A', plazo: '30' })).toEqual({});
  });

  it('busca sin distinguir acentos e incluye teléfono y ubicación', () => {
    expect(filtrarOrdenarClientes(clientes, 'jose', 'todos', 'nombre').map((c) => c.cliente.id)).toEqual(['1']);
    expect(filtrarOrdenarClientes(clientes, '1111', 'todos', 'nombre').map((c) => c.cliente.id)).toEqual(['1']);
    expect(filtrarOrdenarClientes(clientes, 'puesto 18', 'todos', 'nombre').map((c) => c.cliente.id)).toEqual(['2']);
  });

  it('filtra por cartera y ordena por mayor saldo', () => {
    expect(filtrarOrdenarClientes(clientes, '', 'con_saldo', 'saldo_desc').map((c) => c.cliente.id)).toEqual(['1', '2']);
    expect(filtrarOrdenarClientes(clientes, '', 'vencida', 'nombre').map((c) => c.cliente.id)).toEqual(['1']);
  });

  it('ordena por la compra más reciente dejando clientes sin compras al final', () => {
    expect(filtrarOrdenarClientes(clientes, '', 'todos', 'actividad').map((c) => c.cliente.id)).toEqual(['2', '1', '3']);
  });

  it('calcula los indicadores principales de cartera', () => {
    const resumen = resumenClientes(clientes);
    expect(resumen.total).toBe(3);
    expect(resumen.conSaldo).toBe(2);
    expect(resumen.saldoTotal.toString()).toBe('1200');
    expect(resumen.vencidos).toBe(1);
    expect(resumen.saldoVencido.toString()).toBe('600');
    expect(resumen.sinSaldo).toBe(1);
  });
});
