import { beforeEach, describe, expect, it } from 'vitest';
import { fijarToken, usarTransporte } from '../api/cliente';
import { iniciarSesion } from '../auth/sesion';
import { db } from '../db/db';
import { estadoCuentaProductorLocal, saldosProductoresLocales } from '../dominio/consultas';
import { registrarMovimientoDinero } from '../dominio/operaciones';
import { manejarSolicitud, reiniciarServidorDemo } from '../demo/servidor';
import { sincronizar } from '../sync/motor';
import { nuevoId } from '../lib/ids';
import { D, aImporte, sumar } from '../lib/dinero';

usarTransporte((m, r, c, t) => manejarSolicitud(m, r, c, t));

async function entrar(usuario = 'ana') {
  await iniciarSesion(usuario, 'demo1234');
  await sincronizar();
}

beforeEach(async () => {
  fijarToken(null);
  await db.delete();
  await db.open();
  await reiniciarServidorDemo();
});

describe('liquidaciones y cuenta de productor en frontend', () => {
  it('calcula saldo local considerando pagos y anticipos pendientes en cola', async () => {
    await entrar('ana');
    const proveedores = await db.proveedores.toArray();
    const prov = proveedores.find((p) => p.nombre.includes('Don Ale')) ?? proveedores[0];

    // Verificar saldo inicial antes de registrar nuevo pago
    const saldosAntes = await saldosProductoresLocales();
    const saldoAntes = Number(saldosAntes.find((s) => s.proveedorId === prov.id)?.saldo ?? 0);

    // Registrar un pago al productor sin conexión (queda como operación pendiente en Dexie)
    await registrarMovimientoDinero({
      categoria: 'pago_proveedor',
      concepto: `Abono semanal · ${prov.nombre}`,
      monto: '500.00',
      metodo: 'efectivo',
      proveedorId: prov.id,
    });

    // Registrar un anticipo pendiente al mismo productor
    await registrarMovimientoDinero({
      categoria: 'anticipo_productor',
      concepto: `Anticipo para diesel · ${prov.nombre}`,
      monto: '200.00',
      metodo: 'efectivo',
      proveedorId: prov.id,
    });

    // El estado de cuenta local y la lista de saldos deben incluir los pagos/anticipos pendientes
    const saldosDespues = await saldosProductoresLocales();
    const saldoDespues = Number(saldosDespues.find((s) => s.proveedorId === prov.id)?.saldo ?? 0);
    expect(saldoDespues).toBe(saldoAntes - 700);

    const estadoLocal = await estadoCuentaProductorLocal(prov.id);
    expect(Number(estadoLocal.saldo)).toBe(saldoAntes - 700);

    // Debe mostrar los movimientos pendientes en los items
    const pendientes = estadoLocal.items.filter((i) => i.concepto.includes('(pendiente)'));
    expect(pendientes).toHaveLength(2);
  });

  it('calcula correctamente la vista previa del corte con comisión y descuentos', () => {
    // Simular renglones de venta a liquidar
    const renglones = [
      { id: nuevoId(), importe: '1200.00', cantidad: '60.00', comisionTipo: 'porcentaje' as const, comisionValor: '10.00' },
      { id: nuevoId(), importe: '800.00', cantidad: '40.00', comisionTipo: 'porcentaje' as const, comisionValor: '10.00' },
    ];

    const conceptos = [
      { tipo: 'flete' as const, concepto: 'Flete camión', monto: '150.00' },
      { tipo: 'merma' as const, concepto: 'Merma pactada', monto: '50.00' },
    ];

    const totalVendido = aImporte(sumar(renglones.map((r) => D(r.importe))));
    const unidadesVendidas = sumar(renglones.map((r) => D(r.cantidad))).toFixed(2);
    expect(totalVendido).toBe('2000.00');
    expect(unidadesVendidas).toBe('100.00');

    // Comisión calculada al 10%
    const comisionCalculada = aImporte(D(totalVendido).mul(10).div(100));
    expect(comisionCalculada).toBe('200.00');

    // Descuentos: 150 + 50 = 200
    const descuentosTotal = aImporte(sumar(conceptos.map((c) => D(c.monto))));
    expect(descuentosTotal).toBe('200.00');

    // Neto calculado: 2000 - 200 - 200 = 1600
    const neto = aImporte(D(totalVendido).minus(D(comisionCalculada)).minus(D(descuentosTotal)));
    expect(neto).toBe('1600.00');
  });
});
