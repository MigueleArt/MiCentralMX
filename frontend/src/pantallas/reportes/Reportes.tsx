import { useQuery } from '@tanstack/react-query';
import { ChartColumn, HandCoins, Package, PackageMinus, Receipt, ShoppingCart, Wallet, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/cliente';
import { ErrorConsulta, Esqueleto } from '../../componentes/Estados';
import { Campo, Chips } from '../../componentes/Formulario';
import type { ResumenReportes } from '@micentralmx/shared/api';
import { useFormato } from '../../hooks/useFormato';
import { EncabezadoPagina, EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN, formatoMXNSigno } from '../../lib/dinero';
import { diaLocal, formatoDia, sumarDias } from '../../lib/fechas';
import { useConectividad } from '../../sync/conectividad';

type Periodo = 'hoy' | 'semana' | 'mes' | 'rango';

function rango(p: Periodo, desde: string, hasta: string): [string, string] {
  const hoy = diaLocal();
  if (p === 'hoy') return [hoy, hoy];
  if (p === 'semana') return [sumarDias(hoy, -6), hoy];
  if (p === 'mes') return [`${hoy.slice(0, 8)}01`, hoy];
  return [desde, hasta];
}

function Tarjeta({ icono: Icono, titulo, detalle, valor }: { icono: LucideIcon; titulo: string; detalle: string; valor: string }) {
  return (
    <div className="rowlink" style={{ cursor: 'default' }}>
      <span className="ib">
        <Icono className="ic" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600 }}>{titulo}</p>
        <p className="t-aux num">{detalle}</p>
      </div>
      <p className="num" style={{ fontWeight: 700, fontSize: 17 }}>
        {valor}
      </p>
    </div>
  );
}

/** Pantalla 26 · Reportes consolidados (solo en línea, decisiones técnicas §4.5). */
export default function Reportes() {
  const formato = useFormato();
  const { enLinea } = useConectividad();
  const [periodo, setPeriodo] = useState<Periodo>('semana');
  const [desde, setDesde] = useState(sumarDias(diaLocal(), -6));
  const [hasta, setHasta] = useState(diaLocal());
  const [d, h] = rango(periodo, desde, hasta);
  const q = useQuery({
    queryKey: ['reportes', d, h],
    queryFn: () => api<ResumenReportes>('GET', `/reportes/resumen?desde=${d}&hasta=${h}`),
  });
  const r = q.data;

  return (
    <>
      {formato === 'telefono' ? <EncabezadoSecundario titulo="Reportes" volverA="/mas" /> : <EncabezadoPagina titulo="Reportes" />}
      <main className={`pag-main${formato === 'telefono' ? ' con-enc-sec' : ''}`}>
        <div className="pila-16" style={{ maxWidth: 960 }}>
          <Chips<Periodo>
            etiqueta="Periodo"
            valor={periodo}
            alCambiar={setPeriodo}
            opciones={[
              { valor: 'hoy', texto: 'Hoy' },
              { valor: 'semana', texto: 'Esta semana' },
              { valor: 'mes', texto: 'Este mes' },
              { valor: 'rango', texto: 'Elegir fechas' },
            ]}
          />
          {periodo === 'rango' && (
            <div className="rejilla-2" style={{ gap: 12 }}>
              <Campo etiqueta="Desde" id="r-desde">
                <input id="r-desde" type="date" className="inp" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
              </Campo>
              <Campo etiqueta="Hasta" id="r-hasta">
                <input id="r-hasta" type="date" className="inp" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
              </Campo>
            </div>
          )}
          <p className="t-2 num">
            Del {formatoDia(d)} al {formatoDia(h)}
          </p>
          {q.isPending ? (
            <Esqueleto filas={3} texto="Cargando reportes…" />
          ) : q.isError ? (
            <ErrorConsulta error={q.error} enLinea={enLinea} reintentar={() => void q.refetch()} />
          ) : (
            r && (
              <div className="card" style={{ overflow: 'hidden' }}>
                <Tarjeta icono={Receipt} titulo="Ventas" detalle={`${r.ventas.cantidad} ventas · ${r.ventas.aCredito} a crédito`} valor={formatoMXN(r.ventas.total)} />
                <Tarjeta icono={ShoppingCart} titulo="Compras" detalle={`${r.compras.cantidad} compras · ${r.compras.proveedores} proveedores`} valor={formatoMXN(r.compras.total)} />
                <Tarjeta icono={Package} titulo="Inventario" detalle={`${r.inventario.bajos} con inventario bajo`} valor={`${r.inventario.productos} productos`} />
                <Tarjeta
                  icono={Wallet}
                  titulo="Pagos"
                  detalle={`Ingresos ${formatoMXN(r.pagos.ingresos)} · Egresos ${formatoMXN(r.pagos.egresos)}`}
                  valor={formatoMXNSigno(D(r.pagos.ingresos).minus(r.pagos.egresos))}
                />
                <Tarjeta icono={HandCoins} titulo="Deudas" detalle={`Por cobrar · ${formatoMXN(r.deudas.vencido)} vencido`} valor={formatoMXN(r.deudas.porCobrar)} />
                <Tarjeta icono={PackageMinus} titulo="Mermas" detalle={`Valor aproximado ${formatoMXN(r.mermas.valor)}`} valor={`${r.mermas.cantidad} ${r.mermas.unidad}`} />
              </div>
            )
          )}
          <p className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <ChartColumn className="ic" style={{ width: 14, height: 14 }} />
            Reportes calculados en el servidor con la fecha del dispositivo de cada operación. Mermas valoradas con el último costo de compra.
          </p>
        </div>
      </main>
    </>
  );
}
