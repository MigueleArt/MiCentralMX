import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, HandCoins } from 'lucide-react';
import { Link } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { deudasVista } from '../../dominio/consultas';
import { resumenDeudas } from '../../dominio/resumenes';
import { EncabezadoPagina } from '../../layout/Encabezados';
import { MAS_ADMIN, MAS_OPERACION, type Destino } from '../../layout/navegacion';
import { formatoMXN } from '../../lib/dinero';

const DETALLE: Record<string, string> = {
  '/pagos': 'Ingresos y egresos',
  '/usuarios': 'Roles y permisos',
  '/revisiones': 'Operaciones con observaciones',
};

/** Pantalla 02 · Más (teléfono y tablet). */
export default function Mas() {
  const { puede } = useSesionActiva();
  const deudas = useLiveQuery(async () => resumenDeudas(await deudasVista()));
  const fila = (d: Destino) => (
    <Link key={d.ruta} className="rowlink" to={d.ruta}>
      <span className="ib">
        <d.icono className="ic" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600 }}>{d.texto}</p>
        {DETALLE[d.ruta] && <p className="t-aux">{DETALLE[d.ruta]}</p>}
      </div>
      <ChevronRight className="ic" />
    </Link>
  );
  const operacion = MAS_OPERACION.filter((d) => !d.permiso || puede(d.permiso));
  const admin = MAS_ADMIN.filter((d) => !d.permiso || puede(d.permiso));
  return (
    <>
      <EncabezadoPagina titulo="Más" />
      <main className="pag-main">
        <section className="pila">
          <h2 className="lbl">Operación</h2>
          <div className="card" style={{ overflow: 'hidden' }}>
            <Link className="rowlink" to="/deudas">
              <span className="ib">
                <HandCoins className="ic" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 600 }}>Deudas</p>
                <p className="t-aux num">Por cobrar {formatoMXN(deudas?.porCobrar ?? 0)}</p>
              </div>
              {(deudas?.vencidas.length ?? 0) > 0 && (
                <span className="bdg b-err bdg-sm">
                  {deudas!.vencidas.length} {deudas!.vencidas.length === 1 ? 'vencida' : 'vencidas'}
                </span>
              )}
              <ChevronRight className="ic" />
            </Link>
            {operacion.map(fila)}
          </div>
        </section>
        {admin.length > 0 && (
          <section className="pila">
            <h2 className="lbl">Administración</h2>
            <div className="card" style={{ overflow: 'hidden' }}>
              {admin.map(fila)}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
