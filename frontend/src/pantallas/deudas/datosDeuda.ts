import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { cargarOperaciones, sincronizacionDe, ventaVista } from '../../dominio/consultas';
import { D } from '../../lib/dinero';

/** Deuda (venta a crédito) con los pagos aplicados a ella, del servidor y de este dispositivo. */
export function useDeuda(ventaId: string | undefined) {
  return useLiveQuery(async () => {
    if (!ventaId) return null;
    const [v, pagos, { porId }] = await Promise.all([ventaVista(ventaId), db.pagos.toArray(), cargarOperaciones()]);
    if (!v) return null;
    const aplicados = pagos
      .filter((p) => sincronizacionDe(porId, p.operacionId) !== 'rechazada')
      .flatMap((p) =>
        p.aplicaciones
          .filter((a) => a.ventaId === ventaId)
          .map((a) => ({ pago: p, monto: D(a.monto), sync: sincronizacionDe(porId, p.operacionId) })),
      )
      .sort((a, b) => b.pago.creadoEnDispositivo.localeCompare(a.pago.creadoEnDispositivo));
    // Saldo restante después de cada pago, del más antiguo al más reciente.
    let saldo = D(v.venta.total);
    const conSaldo = [...aplicados].reverse().map((x) => {
      saldo = saldo.minus(x.monto);
      return { ...x, saldoDespues: saldo };
    });
    return { v, pagos: conSaldo.reverse() };
  }, [ventaId]);
}

export type DatosDeuda = NonNullable<ReturnType<typeof useDeuda>>;
