import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Buscador, Chips, coincide } from '../../componentes/Formulario';
import { InsigniaSync } from '../../componentes/Insignias';
import { BannerSinConexion } from '../../componentes/Sincronizacion';
import { db } from '../../db/db';
import { cargarOperaciones, sincronizacionDe } from '../../dominio/consultas';
import { cantidadConUnidad, folioCompra } from '../../dominio/formato';
import { useFormato } from '../../hooks/useFormato';
import { EncabezadoPagina, EncabezadoSecundario } from '../../layout/Encabezados';
import { formatoMXN, sumar } from '../../lib/dinero';
import { diaLocal, formatoDia, formatoHora, formatoRelativo, sumarDias } from '../../lib/fechas';

type Periodo = 'hoy' | 'semana' | 'todas';

/** Pantalla 23 · Compras. */
export default function Compras() {
  const { puede } = useSesionActiva();
  const formato = useFormato();
  const [q, setQ] = useState('');
  const [periodo, setPeriodo] = useState<Periodo>('hoy');
  const compras = useLiveQuery(async () => {
    const [lista, { porId }] = await Promise.all([db.compras.orderBy('creadoEnDispositivo').reverse().toArray(), cargarOperaciones()]);
    return lista.map((c) => ({ c, sync: sincronizacionDe(porId, c.operacionId) })).filter((x) => x.sync !== 'rechazada');
  });

  const hoy = (compras ?? []).filter((x) => diaLocal(x.c.creadoEnDispositivo) === diaLocal());
  const desde = periodo === 'hoy' ? diaLocal() : periodo === 'semana' ? sumarDias(diaLocal(), -6) : '0000';
  const lista = (compras ?? []).filter(
    (x) => diaLocal(x.c.creadoEnDispositivo) >= desde && coincide(`${folioCompra(x.c)} ${x.c.proveedorNombre} ${x.c.renglones.map((r) => r.productoNombre).join(' ')}`, q),
  );
  const nueva = puede('compras.crear') && (
    <Link className="btn btn-p" to="/compras/nueva">
      <Plus className="ic" />
      Nueva compra
    </Link>
  );

  return (
    <>
      {formato === 'telefono' ? <EncabezadoSecundario titulo="Compras" volverA="/mas" /> : <EncabezadoPagina titulo="Compras" acciones={nueva} />}
      <main className={`pag-main${formato === 'telefono' ? ' con-enc-sec con-barra' : ''}`}>
        <div className="pila-16" style={formato === 'telefono' ? undefined : { maxWidth: 960 }}>
          <BannerSinConexion />
          <div className="card kpi fila-entre">
            <div>
              <p className="t-2">Compras de hoy</p>
              <p className="num" style={{ fontSize: 28, lineHeight: '34px', fontWeight: 700 }}>
                {formatoMXN(sumar(hoy.map((x) => x.c.total)))}
              </p>
            </div>
            <p className="t-2 num">
              <strong style={{ color: 'var(--texto)', fontSize: 16 }}>{hoy.length}</strong> {hoy.length === 1 ? 'compra' : 'compras'}
            </p>
          </div>
          <Buscador valor={q} alCambiar={setQ} etiqueta="Buscar compra" marcador="Buscar compra o proveedor" />
          <Chips<Periodo>
            etiqueta="Periodo"
            valor={periodo}
            alCambiar={setPeriodo}
            opciones={[
              { valor: 'hoy', texto: 'Hoy' },
              { valor: 'semana', texto: 'Esta semana' },
              { valor: 'todas', texto: 'Todas' },
            ]}
          />
          {!compras ? (
            <Esqueleto />
          ) : lista.length === 0 ? (
            <EstadoVacio icono={ShoppingCart} titulo={compras.length === 0 ? 'Aún no hay compras' : 'No encontramos compras'} texto={compras.length === 0 ? 'Registra la mercancía que recibes para actualizar existencias.' : 'Prueba con otro periodo o búsqueda.'} />
          ) : (
            <section className="pila" aria-label="Compras">
              {lista.map(({ c, sync }) => (
                <article key={c.id} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="fila-entre" style={{ alignItems: 'flex-start' }}>
                    <p className="t-aux num">
                      Compra {folioCompra(c)} · {diaLocal(c.creadoEnDispositivo) === diaLocal() ? formatoHora(c.creadoEnDispositivo) : formatoRelativo(c.creadoEnDispositivo)}
                    </p>
                    <p className="num" style={{ fontSize: 18, fontWeight: 700 }}>
                      {formatoMXN(c.total)}
                    </p>
                  </div>
                  <p style={{ fontWeight: 600 }}>{c.proveedorNombre}</p>
                  {c.renglones.map((r, i) => (
                    <p key={i} className="t-2 num">
                      {cantidadConUnidad(r.cantidad, { nombre: r.unidadNombre, plural: r.unidadPlural })} · {r.productoNombre} {r.clasificacionNombre}
                    </p>
                  ))}
                  <div className="fila" style={{ flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                    <span className="bdg b-ok">Registrada</span>
                    {c.formaPago === 'credito' && <span className="bdg b-warn">A crédito{c.venceEl ? ` · vence ${formatoDia(c.venceEl)}` : ''}</span>}
                    <InsigniaSync estado={sync} />
                  </div>
                </article>
              ))}
            </section>
          )}
        </div>
      </main>
      {formato === 'telefono' && puede('compras.crear') && (
        <div className="barra-accion">
          <Link className="btn btn-p btn-lg" style={{ flex: 1 }} to="/compras/nueva">
            <Plus className="ic" />
            Nueva compra
          </Link>
        </div>
      )}
    </>
  );
}
