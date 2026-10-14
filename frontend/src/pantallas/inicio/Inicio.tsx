import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronRight,
  ClipboardCheck,
  Scale,
  CircleAlert,
  HandCoins,
  PackagePlus,
  Plus,
  Receipt,
  ShoppingCart,
  TriangleAlert,
  UserPlus,
  Wallet,
  Package,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../api/cliente';
import { useConectividad } from '../../sync/conectividad';
import { useAlertasInventario } from '../inventario/AlertasConciliacion';
import { useSesionActiva } from '../../auth/SesionContext';
import { Esqueleto } from '../../componentes/Estados';
import { FilaMovimiento } from '../../componentes/FilaMovimiento';
import { Marca } from '../../componentes/Marca';
import { EstadoSync, useAbrirSincronizacion } from '../../componentes/Sincronizacion';
import type { Permiso } from '@micentralmx/shared/permisos';
import { folioCompra, cantidadConUnidad } from '../../dominio/formato';
import { resumenInicio } from '../../dominio/resumenes';
import { useFormato } from '../../hooks/useFormato';
import { formatoMXN, formatoMXNSigno, D } from '../../lib/dinero';
import { formatoDiaFecha, formatoDia, formatoHora } from '../../lib/fechas';
import { EncabezadoPagina } from '../../layout/Encabezados';

interface Acceso {
  ruta: string;
  texto: string;
  icono: LucideIcon;
  permiso: Permiso;
}
const ACCESOS: Acceso[] = [
  { ruta: '/cobrar', texto: 'Registrar pago', icono: HandCoins, permiso: 'pagos.registrar' },
  { ruta: '/inventario/nuevo', texto: 'Agregar producto', icono: PackagePlus, permiso: 'catalogo.editar' },
  { ruta: '/compras/nueva', texto: 'Registrar compra', icono: ShoppingCart, permiso: 'compras.crear' },
  { ruta: '/clientes/nuevo', texto: 'Agregar cliente', icono: UserPlus, permiso: 'clientes.crear' },
];

function Kpi({ to, etiqueta, valor, detalle, icono: Icono, grande }: { to?: string; etiqueta: string; valor: string; detalle: string; icono?: LucideIcon; grande?: boolean }) {
  const cuerpo = (
    <>
      <p className="t-2" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {Icono && <Icono className="ic" style={{ width: 16, height: 16 }} />}
        {etiqueta}
      </p>
      <p className="num" style={{ fontSize: grande ? 28 : 22, lineHeight: grande ? '34px' : '28px', fontWeight: 700 }}>
        {valor}
      </p>
      <p className="t-aux">{detalle}</p>
    </>
  );
  const estilo = { padding: grande ? '16px 18px' : '12px 14px', display: 'flex', flexDirection: 'column' as const, gap: grande ? 4 : 0 };
  return to ? (
    <Link className="card" to={to} style={estilo}>
      {cuerpo}
    </Link>
  ) : (
    <div className="card" style={estilo}>
      {cuerpo}
    </div>
  );
}

/** Pantallas 01 (teléfono) y 02 (Inicio · PC 1440). */
export default function Inicio() {
  const { sesion, puede } = useSesionActiva();
  const formato = useFormato();
  const abrirSync = useAbrirSincronizacion();
  const r = useLiveQuery(resumenInicio);
  const { enLinea } = useConectividad();
  // Operaciones de todo el negocio que esperan resolución (solo en línea y con permiso).
  const revisiones = useQuery({
    queryKey: ['revisiones', 'conteo'],
    queryFn: () => api<{ pendientes: number }>('GET', '/revisiones/conteo'),
    enabled: enLinea && puede('revisiones.resolver'),
    refetchInterval: 60_000,
  });
  const porResolver = revisiones.data?.pendientes ?? 0;
  const descuadres = useAlertasInventario().data?.length ?? 0;
  const nombre = sesion.usuario.nombre.split(' ')[0];
  const accesos = ACCESOS.filter((a) => puede(a.permiso));
  const ancho = formato !== 'telefono';

  if (!r) {
    return (
      <main className="pag-main" style={{ paddingTop: 16 }}>
        <Esqueleto filas={3} />
      </main>
    );
  }

  const { deudas, bajos } = r;
  const atencion = (
    <section className="card" aria-labelledby="att" style={{ overflow: 'hidden' }}>
      <h2 id="att" className="lbl" style={{ padding: '12px 14px 4px' }}>
        Necesita atención
      </h2>
      {/* Quien resuelve revisiones ve el conteo del servidor; los demás, lo de este dispositivo. */}
      {r.porRevisar > 0 && !puede('revisiones.resolver') && (
        <button type="button" className="rowlink" onClick={abrirSync}>
          <span className="cuadro-ic" style={{ background: 'var(--acento-fondo)', color: 'var(--acento-texto)' }}>
            <TriangleAlert className="ic" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 600, fontSize: 15 }}>
              {r.porRevisar} {r.porRevisar === 1 ? 'operación por revisar' : 'operaciones por revisar'}
            </p>
            <p className="t-aux">Quedaron en revisión al sincronizar</p>
          </div>
          <ChevronRight className="ic" />
        </button>
      )}
      {porResolver > 0 && (
        <Link className="rowlink" to="/revisiones">
          <span className="cuadro-ic" style={{ background: 'var(--acento-fondo)', color: 'var(--acento-texto)' }}>
            <ClipboardCheck className="ic" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 600, fontSize: 15 }}>
              {porResolver} {porResolver === 1 ? 'operación por resolver' : 'operaciones por resolver'}
            </p>
            <p className="t-aux">Llegaron de los dispositivos con observaciones</p>
          </div>
          <ChevronRight className="ic" />
        </Link>
      )}
      {descuadres > 0 && (
        <Link className="rowlink" to="/inventario">
          <span className="cuadro-ic" style={{ background: 'var(--aviso-fondo)', color: 'var(--aviso-texto)' }}>
            <Scale className="ic" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 600, fontSize: 15 }}>
              {descuadres} {descuadres === 1 ? 'existencia no coincide' : 'existencias no coinciden'} con su historial
            </p>
            <p className="t-aux">Lo detectó la revisión nocturna del inventario</p>
          </div>
          <ChevronRight className="ic" />
        </Link>
      )}
      {ancho ? (
        <>
          {deudas.vencidas.map((d) => (
            <Link key={d.venta.id} className="rowlink" to={`/deudas/${d.venta.id}`}>
              <span className="cuadro-ic" style={{ background: 'var(--error-fondo)', color: 'var(--error-texto)' }}>
                <CircleAlert className="ic" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 600 }}>{d.venta.clienteNombre} · deuda vencida</p>
                <p className="t-aux">Venció {d.venta.venceEl && formatoDia(d.venta.venceEl)}</p>
              </div>
              <p className="num" style={{ fontWeight: 700, fontSize: 16, width: 96, textAlign: 'right' }}>
                {formatoMXN(d.saldo)}
              </p>
            </Link>
          ))}
          {bajos.map((b) => (
            <Link key={b.nombre} className="rowlink" to={`/inventario/${b.productoId}`}>
              <span className="cuadro-ic" style={{ background: 'var(--aviso-fondo)', color: 'var(--aviso-texto)' }}>
                <Package className="ic" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 600 }}>{b.nombre}</p>
                <p className="t-aux">{b.sinExistencia ? 'Sin existencia' : 'Inventario bajo'}</p>
              </div>
              <p className="num" style={{ fontWeight: 700, fontSize: 16, textAlign: 'right' }}>
                {b.cantidad}
              </p>
            </Link>
          ))}
        </>
      ) : (
        <>
          {deudas.vencidas.length > 0 && (
            <Link className="rowlink" to="/deudas">
              <span className="cuadro-ic" style={{ background: 'var(--error-fondo)', color: 'var(--error-texto)' }}>
                <CircleAlert className="ic" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 15 }}>
                  {deudas.vencidas.length} {deudas.vencidas.length === 1 ? 'deuda vencida' : 'deudas vencidas'}
                </p>
                <p className="t-aux">
                  {deudas.vencidas.slice(0, 2).map((d) => d.venta.clienteNombre).join(', ')}
                  {deudas.vencidas.length > 2 && ` y ${deudas.vencidas.length - 2} más`}
                </p>
              </div>
              <p className="num" style={{ fontWeight: 700 }}>
                {formatoMXN(deudas.totalVencido)}
              </p>
              <ChevronRight className="ic" />
            </Link>
          )}
          {bajos.length > 0 && (
            <Link className="rowlink" to="/inventario?filtro=bajo">
              <span className="cuadro-ic" style={{ background: 'var(--aviso-fondo)', color: 'var(--aviso-texto)' }}>
                <Package className="ic" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 15 }}>
                  {bajos.length} {bajos.length === 1 ? 'producto con inventario bajo' : 'productos con inventario bajo'}
                </p>
                <p className="t-aux" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {bajos.map((b) => b.nombre.replace(' · ', ' ')).join(', ')}
                </p>
              </div>
              <ChevronRight className="ic" />
            </Link>
          )}
        </>
      )}
      {deudas.vencidas.length === 0 && bajos.length === 0 && (r.porRevisar === 0 || puede('revisiones.resolver')) && porResolver === 0 && descuadres === 0 && (
        <p className="t-2" style={{ padding: '8px 14px 14px' }}>
          Sin pendientes por ahora.
        </p>
      )}
    </section>
  );

  const recientes = (
    <section aria-labelledby="mr" className={ancho ? 'card' : 'pila'} style={ancho ? { overflow: 'hidden' } : undefined}>
      <div className="fila-entre" style={ancho ? { padding: '16px 16px 6px' } : undefined}>
        <h2 id="mr" className="lbl">
          Movimientos recientes
        </h2>
        {puede('historial.ver') && (
          <Link to="/historial" style={{ fontSize: 14, fontWeight: 600 }}>
            {ancho ? 'Ver historial' : 'Ver todo'}
          </Link>
        )}
      </div>
      <div className={ancho ? undefined : 'card'} style={{ overflow: 'hidden' }}>
        {r.recientes.map((m) => (
          <FilaMovimiento key={m.id} m={m} conEtiqueta={ancho} />
        ))}
        {r.recientes.length === 0 && <p className="t-2" style={{ padding: 14 }}>Todavía no hay movimientos.</p>}
      </div>
    </section>
  );

  if (!ancho) {
    return (
      <>
        <header className="pag-enc" style={{ alignItems: 'center', padding: '14px 16px 12px' }}>
          <Marca tamano={32} texto={20} />
          <EstadoSync />
        </header>
        <main className="pag-main">
          <div className="pila-12">
            <div>
              <p className="t-2">{formatoDiaFecha()}</p>
              <h1 style={{ fontSize: 24, lineHeight: '30px', fontWeight: 700 }}>Hola, {nombre}</h1>
            </div>
            {puede('ventas.crear') && (
              <Link className="btn btn-p btn-lg btn-ancho" to="/ventas/nueva">
                <Plus className="ic" />
                Nueva venta
              </Link>
            )}
          </div>
          <div className="rejilla-2">
            <Kpi to="/ventas" etiqueta="Ventas de hoy" valor={formatoMXN(r.ventas.total)} detalle={`${r.ventas.cantidad} ${r.ventas.cantidad === 1 ? 'venta' : 'ventas'}`} />
            <Kpi to="/deudas" etiqueta="Por cobrar" valor={formatoMXN(deudas.porCobrar)} detalle={`${deudas.clientes} ${deudas.clientes === 1 ? 'cliente' : 'clientes'}`} />
          </div>
          {atencion}
          {accesos.length > 0 && (
            <section aria-labelledby="qa" className="pila">
              <h2 id="qa" className="lbl">
                Accesos rápidos
              </h2>
              <div className="rejilla-2">
                {accesos.map((a) => (
                  <Link key={a.ruta} className="tile" to={a.ruta}>
                    <span className="ib">
                      <a.icono className="ic" />
                    </span>
                    {a.texto}
                  </Link>
                ))}
              </div>
            </section>
          )}
          {recientes}
        </main>
      </>
    );
  }

  return (
    <>
      <EncabezadoPagina titulo={`Hola, ${nombre}`} subtitulo={`${formatoDiaFecha()} · ${sesion.negocio.nombre}`} />
      <main className="pag-main">
        <div className="fila" style={{ flexWrap: 'wrap', gap: 12 }}>
          {puede('ventas.crear') && (
            <Link className="btn btn-p btn-lg" to="/ventas/nueva">
              <Plus className="ic" />
              Nueva venta
            </Link>
          )}
          {accesos.map((a) => (
            <Link key={a.ruta} className="btn btn-q" to={a.ruta}>
              <a.icono className="ic" />
              {a.texto}
            </Link>
          ))}
        </div>
        <div className="rejilla-4">
          <Kpi grande to="/ventas" icono={Receipt} etiqueta="Ventas de hoy" valor={formatoMXN(r.ventas.total)} detalle={`${r.ventas.cantidad} ventas`} />
          <Kpi grande to="/deudas" icono={HandCoins} etiqueta="Cuentas por cobrar" valor={formatoMXN(deudas.porCobrar)} detalle={`${formatoMXN(deudas.totalVencido)} vencido`} />
          <Kpi grande to="/inventario?filtro=bajo" icono={Package} etiqueta="Inventario bajo" valor={String(bajos.length)} detalle="productos por surtir" />
          <Kpi grande to="/compras" icono={ShoppingCart} etiqueta="Compras de hoy" valor={formatoMXN(r.comprasHoy.total)} detalle={`${r.comprasHoy.cantidad} compras`} />
        </div>
        <div className="rejilla-3">
          {atencion}
          {recientes}
          <section className="card" style={{ overflow: 'hidden' }} aria-labelledby="cr">
            <div className="fila-entre" style={{ padding: '16px 16px 6px' }}>
              <h2 id="cr" className="lbl">
                Compras recientes
              </h2>
              <Link to="/compras" style={{ fontSize: 14, fontWeight: 600 }}>
                Ver compras
              </Link>
            </div>
            {r.comprasRecientes.map((c) => (
              <Link key={c.id} className="rowlink" to="/compras">
                <span className="cuadro-ic" style={{ background: 'var(--info-fondo)', color: 'var(--info-texto)' }}>
                  <Wallet className="ic" />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 600 }}>{c.proveedorNombre}</p>
                  <p className="t-aux">
                    {formatoHora(c.creadoEnDispositivo)} · {folioCompra(c)} ·{' '}
                    {c.renglones.map((x) => `${cantidadConUnidad(x.cantidad, { nombre: x.unidadNombre, plural: x.unidadPlural })} ${x.productoNombre.split(' ')[0]}`).join(', ')}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <p className="num" style={{ fontWeight: 700 }}>
                    {formatoMXNSigno(D(c.total).neg())}
                  </p>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--error-texto)' }}>Egreso</p>
                </div>
              </Link>
            ))}
            {r.comprasRecientes.length === 0 && <p className="t-2" style={{ padding: 14 }}>Sin compras registradas.</p>}
          </section>
        </div>
      </main>
    </>
  );
}
