import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, ShoppingCart } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { InsigniaInventario, InsigniaSync } from '../../componentes/Insignias';
import { db } from '../../db/db';
import { cargarOperaciones, catalogo, sincronizacionDe } from '../../dominio/consultas';
import { cantidadConUnidad } from '../../dominio/formato';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { D, formatoMXN } from '../../lib/dinero';
import { formatoRelativo } from '../../lib/fechas';

const TIPO: Record<string, string> = {
  inicial: 'Existencia inicial',
  compra: 'Compra',
  venta: 'Venta',
  merma: 'Merma',
  ajuste: 'Ajuste',
  cancelacion: 'Cancelación',
  carga: 'Carga',
  devolucion: 'Devolución',
};

/** Pantalla 16 · Detalle de producto. */
export default function DetalleProducto() {
  const { id } = useParams();
  const { puede } = useSesionActiva();
  const datos = useLiveQuery(async () => {
    const p = (await catalogo(true)).find((x) => x.producto.id === id);
    if (!p) return null;
    const [movs, cargas, existenciasCarga, proveedores, { porId }] = await Promise.all([
      db.movimientosInventario.where('productoId').equals(id!).toArray(),
      db.cargas.toArray(),
      db.existenciasCarga.toArray(),
      db.proveedores.toArray(),
      cargarOperaciones(),
    ]);
    const visibles = movs
      .filter((m) => sincronizacionDe(porId, m.operacionId) !== 'rechazada')
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
      .slice(0, 12)
      .map((m) => ({ m, sync: sincronizacionDe(porId, m.operacionId) }));

    const provMap = new Map(proveedores.map((pr) => [pr.id, pr]));
    const cargaMap = new Map(cargas.map((ca) => [ca.id, ca]));

    const desglosePorClasificacion = new Map<string, Array<{ cargaId: string; proveedorNombre: string; proveedorTipo: string; fecha: string; cantidad: string }>>();
    for (const ec of existenciasCarga) {
      if (D(ec.cantidad).gt(0)) {
        const ca = cargaMap.get(ec.cargaId);
        if (ca) {
          const pr = provMap.get(ca.proveedorId);
          const lista = desglosePorClasificacion.get(ec.clasificacionId) ?? [];
          lista.push({
            cargaId: ca.id,
            proveedorNombre: pr?.nombre ?? 'Proveedor',
            proveedorTipo: pr?.tipo ?? 'tercero',
            fecha: ca.fecha,
            cantidad: ec.cantidad,
          });
          desglosePorClasificacion.set(ec.clasificacionId, lista);
        }
      }
    }

    return { p, movs: visibles, desglosePorClasificacion };
  }, [id]);

  if (datos === undefined) {
    return (
      <>
        <EncabezadoSecundario titulo="Producto" volverA="/inventario" />
        <main className="pag-main con-enc-sec"><Esqueleto filas={2} /></main>
      </>
    );
  }
  if (!datos) {
    return (
      <>
        <EncabezadoSecundario titulo="Producto" volverA="/inventario" />
        <main className="pag-main con-enc-sec">
          <EstadoVacio titulo="No encontramos el producto" texto="Puede que se haya archivado." acciones={<Link className="btn btn-q" to="/inventario">Ir a inventario</Link>} />
        </main>
      </>
    );
  }
  const { p, movs, desglosePorClasificacion } = datos;
  const clas = p.clasificaciones.filter((c) => !c.clasificacion.archivadoEn);
  return (
    <>
      <EncabezadoSecundario
        titulo={p.producto.nombre}
        subtitulo={p.producto.archivadoEn ? 'Archivado' : `Se vende por ${p.unidad.nombre}`}
        volverA="/inventario"
        conSync={false}
        acciones={
          puede('catalogo.editar') &&
          !p.producto.archivadoEn && (
            <Link className="icon-btn" to={`/inventario/${p.producto.id}/editar`} aria-label="Editar producto">
              <Pencil className="ic" />
            </Link>
          )
        }
      />
      <main className="pag-main con-enc-sec con-barra">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto' }}>
          <div className="rejilla-2">
            <div className="card kpi">
              <p className="t-aux">Existencia total</p>
              <p className="valor num">{cantidadConUnidad(p.total.toString(), p.unidad)}</p>
            </div>
            <div className="card kpi">
              <p className="t-aux">Aviso de inventario bajo</p>
              <p className="valor num" style={{ fontSize: 17 }}>{cantidadConUnidad(p.producto.umbralBajo, p.unidad)} o menos</p>
            </div>
          </div>
          <section className="pila">
            <h2 className="lbl">Clasificaciones y existencias por carga</h2>
            <div className="card" style={{ overflow: 'hidden' }}>
              {clas.map((c) => {
                const cargasDeClas = desglosePorClasificacion.get(c.clasificacion.id) ?? [];
                return (
                  <div key={c.clasificacion.id} style={{ borderBottom: '1px solid var(--borde-tenue)', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 600 }}>{c.clasificacion.nombre}</p>
                        <p className="t-aux num" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {cantidadConUnidad(c.existencia.toString(), p.unidad)}
                          <InsigniaInventario bajo={c.bajo} sin={c.sinExistencia} />
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p className="num" style={{ fontWeight: 700 }}>{formatoMXN(c.clasificacion.precio)}</p>
                        {c.clasificacion.ultimoCosto && <p className="t-aux num">Costo {formatoMXN(c.clasificacion.ultimoCosto)}</p>}
                      </div>
                    </div>
                    {cargasDeClas.length > 0 && (
                      <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--fondo-control)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <p className="t-aux" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Desglose por carga:
                        </p>
                        {cargasDeClas.map((cg) => (
                          <div key={cg.cargaId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                            <span style={{ color: 'var(--texto)' }}>
                              {cg.proveedorNombre} ({cg.proveedorTipo === 'rancho_propio' ? 'Rancho' : 'Consigna'}) · {cg.fecha}
                            </span>
                            <span className="num" style={{ fontWeight: 600 }}>
                              {cg.cantidad} {p.unidad.plural}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          <section className="pila">
            <h2 className="lbl">Movimientos recientes</h2>
            <div className="card" style={{ overflow: 'hidden' }}>
              {movs.map(({ m, sync }) => {
                const c = p.clasificaciones.find((x) => x.clasificacion.id === m.clasificacionId);
                const delta = D(m.delta);
                return (
                  <div key={m.id} className="rowlink" style={{ cursor: 'default' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, fontSize: 15 }}>
                        {m.referencia ?? TIPO[m.tipo]}
                        {m.motivo && m.tipo !== 'venta' ? ` · ${m.motivo.toLowerCase()}` : ''}
                      </p>
                      <p className="t-aux">
                        {formatoRelativo(m.creadoEn)} · {c?.clasificacion.nombre}
                      </p>
                      <InsigniaSync estado={sync} />
                    </div>
                    <p className="num" style={{ fontWeight: 700, color: delta.isNegative() ? 'var(--error-texto)' : 'var(--ok-texto)' }}>
                      {delta.isNegative() ? '−' : '+'}
                      {delta.abs().toString()}
                    </p>
                  </div>
                );
              })}
              {movs.length === 0 && <p className="t-2" style={{ padding: 14 }}>Sin movimientos en este dispositivo.</p>}
            </div>
          </section>
        </div>
      </main>
      {!p.producto.archivadoEn && (
        <div className="barra-accion">
          {puede('compras.crear') && (
            <Link className="btn btn-q" style={{ flex: 1 }} to={`/compras/nueva?producto=${p.producto.id}`}>
              <ShoppingCart className="ic" />
              Registrar compra
            </Link>
          )}
          {puede('ventas.crear') && (
            <Link className="btn btn-p" style={{ flex: 1 }} to="/ventas/nueva">
              <Plus className="ic" />
              Nueva venta
            </Link>
          )}
        </div>
      )}
    </>
  );
}
