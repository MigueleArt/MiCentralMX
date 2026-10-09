import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownLeft, ArrowUpRight, HandCoins, Plus, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Chips } from '../../componentes/Formulario';
import { InsigniaSync } from '../../componentes/Insignias';
import { BannerSinConexion } from '../../componentes/Sincronizacion';
import { db, type EstadoSync } from '../../db/db';
import { cargarOperaciones, sincronizacionDe } from '../../dominio/consultas';
import { ETIQUETA_METODO, folioVenta } from '../../dominio/formato';
import { useFormato } from '../../hooks/useFormato';
import { EncabezadoPagina, EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN, formatoMXNSigno, sumar } from '../../lib/dinero';
import { diaLocal, formatoHora, formatoRelativo } from '../../lib/fechas';
import { RegistrarMovimiento } from './RegistrarMovimiento';

type Filtro = 'todos' | 'ingreso' | 'egreso';
interface Fila {
  id: string;
  tipo: 'ingreso' | 'egreso';
  icono: 'cobro' | 'ingreso' | 'egreso';
  titulo: string;
  detalle: string;
  monto: string;
  fecha: string;
  sync: EstadoSync | null;
}

/** Pantalla 25 · Pagos: cobros a clientes, pagos a proveedores e ingresos/egresos simples. */
export default function Pagos() {
  const { puede } = useSesionActiva();
  const formato = useFormato();
  const avisar = useAvisos();
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [registrar, setRegistrar] = useState(false);
  const filas = useLiveQuery(async () => {
    const [pagos, dinero, ventas, { porId }] = await Promise.all([db.pagos.toArray(), db.movimientosDinero.toArray(), db.ventas.toArray(), cargarOperaciones()]);
    const lista: Fila[] = [
      ...pagos.map((p) => {
        const v = p.aplicaciones.length === 1 ? ventas.find((x) => x.id === p.aplicaciones[0].ventaId) : undefined;
        return {
          id: p.id,
          tipo: 'ingreso' as const,
          icono: 'cobro' as const,
          titulo: `Pago de cliente · ${p.clienteNombre}`,
          detalle: `${ETIQUETA_METODO[p.metodo]}${v ? ` · Deuda ${folioVenta(v)}` : ''}`,
          monto: p.monto,
          fecha: p.creadoEnDispositivo,
          sync: sincronizacionDe(porId, p.operacionId),
        };
      }),
      ...dinero.map((m) => ({
        id: m.id,
        tipo: m.tipo,
        icono: m.tipo,
        titulo: m.tipo === 'ingreso' && m.categoria !== 'otro_ingreso' ? `Ingreso · ${m.concepto}` : m.concepto,
        detalle: ETIQUETA_METODO[m.metodo],
        monto: m.monto,
        fecha: m.creadoEn,
        sync: sincronizacionDe(porId, m.operacionId),
      })),
    ];
    return lista.filter((f) => f.sync !== 'rechazada').sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  const hoy = (filas ?? []).filter((f) => diaLocal(f.fecha) === diaLocal());
  const ingresos = sumar(hoy.filter((f) => f.tipo === 'ingreso').map((f) => f.monto));
  const egresos = sumar(hoy.filter((f) => f.tipo === 'egreso').map((f) => f.monto));
  const lista = (filas ?? []).filter((f) => filtro === 'todos' || f.tipo === filtro);
  const ICONOS = {
    cobro: [HandCoins, 'var(--ok-fondo)', 'var(--ok-texto)'],
    ingreso: [ArrowDownLeft, 'var(--ok-fondo)', 'var(--ok-texto)'],
    egreso: [ArrowUpRight, 'var(--error-fondo)', 'var(--error-texto)'],
  } as const;
  const boton = puede('dinero.registrar') && (
    <button type="button" className="btn btn-p" onClick={() => setRegistrar(true)}>
      <Plus className="ic" />
      Registrar movimiento
    </button>
  );

  return (
    <>
      {formato === 'telefono' ? <EncabezadoSecundario titulo="Pagos" volverA="/mas" /> : <EncabezadoPagina titulo="Pagos" subtitulo="Ingresos y egresos" acciones={boton} />}
      <main className={`pag-main${formato === 'telefono' ? ' con-enc-sec con-barra' : ''}`}>
        <div className="pila-16" style={formato === 'telefono' ? undefined : { maxWidth: 960 }}>
          <BannerSinConexion />
          <div className="rejilla-2">
            <div className="card kpi">
              <p className="t-aux" style={{ color: 'var(--ok-texto)', fontWeight: 600 }}>Ingresos hoy</p>
              <p className="valor num">{formatoMXN(ingresos)}</p>
            </div>
            <div className="card kpi">
              <p className="t-aux" style={{ color: 'var(--error-texto)', fontWeight: 600 }}>Egresos hoy</p>
              <p className="valor num">{formatoMXN(egresos)}</p>
            </div>
          </div>
          <Chips<Filtro>
            etiqueta="Filtrar movimientos"
            valor={filtro}
            alCambiar={setFiltro}
            opciones={[
              { valor: 'todos', texto: 'Todos' },
              { valor: 'ingreso', texto: 'Ingresos' },
              { valor: 'egreso', texto: 'Egresos' },
            ]}
          />
          {!filas ? (
            <Esqueleto />
          ) : lista.length === 0 ? (
            <EstadoVacio icono={Wallet} titulo="Sin movimientos" texto="Los cobros, pagos a proveedores y otros ingresos o egresos aparecerán aquí." />
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              {lista.map((f) => {
                const [Icono, fondo, color] = ICONOS[f.icono];
                return (
                  <div key={f.id} className="rowlink" style={{ cursor: 'default' }}>
                    <span className="cuadro-ic" style={{ background: fondo, color }}>
                      <Icono className="ic" />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, fontSize: 15 }}>{f.titulo}</p>
                      <p className="t-aux">
                        {diaLocal(f.fecha) === diaLocal() ? `Hoy ${formatoHora(f.fecha)}` : formatoRelativo(f.fecha)} · {f.detalle}
                      </p>
                      <InsigniaSync estado={f.sync} />
                    </div>
                    <div className="pila" style={{ alignItems: 'flex-end', gap: 2 }}>
                      <p className="num" style={{ fontWeight: 700 }}>{formatoMXNSigno(f.tipo === 'ingreso' ? D(f.monto) : D(f.monto).neg())}</p>
                      <span className={`bdg bdg-sm ${f.tipo === 'ingreso' ? 'b-ok' : 'b-errt'}`}>{f.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
      {formato === 'telefono' && puede('dinero.registrar') && (
        <div className="barra-accion">
          <button type="button" className="btn btn-p btn-lg" style={{ flex: 1 }} onClick={() => setRegistrar(true)}>
            <Plus className="ic" />
            Registrar movimiento
          </button>
        </div>
      )}
      {registrar && (
        <RegistrarMovimiento
          alCerrar={() => setRegistrar(false)}
          alRegistrar={(texto) => {
            setRegistrar(false);
            avisar(texto);
          }}
        />
      )}
    </>
  );
}
