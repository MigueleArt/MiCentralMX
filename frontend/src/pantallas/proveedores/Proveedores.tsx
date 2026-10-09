import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Plus, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useSesionActiva } from '../../auth/SesionContext';
import { EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Buscador, coincide } from '../../componentes/Formulario';
import { db } from '../../db/db';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { formatoRelativo } from '../../lib/fechas';

/** Pantalla 22 · Proveedores. */
export default function Proveedores() {
  const { puede } = useSesionActiva();
  const [q, setQ] = useState('');
  const datos = useLiveQuery(async () => {
    const [proveedores, compras] = await Promise.all([db.proveedores.toArray(), db.compras.toArray()]);
    return proveedores
      .filter((p) => !p.archivadoEn)
      .map((p) => ({
        p,
        ultima: compras
          .filter((c) => c.proveedorId === p.id)
          .map((c) => c.creadoEnDispositivo)
          .sort()
          .pop(),
      }))
      .sort((a, b) => a.p.nombre.localeCompare(b.p.nombre, 'es'));
  });
  const lista = (datos ?? []).filter((x) => coincide(`${x.p.nombre} ${x.p.productos}`, q));
  return (
    <>
      <EncabezadoSecundario titulo="Proveedores" volverA="/mas" />
      <main className="pag-main con-enc-sec con-barra">
        <div className="pila-16 contenedor-form" style={{ margin: '0 auto' }}>
          <Buscador valor={q} alCambiar={setQ} etiqueta="Buscar proveedor" marcador="Buscar proveedor" />
          {!datos ? (
            <Esqueleto />
          ) : datos.length === 0 ? (
            <EstadoVacio icono={Truck} titulo="Aún no hay proveedores" texto="Agrega a quienes te surten mercancía para registrar compras." />
          ) : lista.length === 0 ? (
            <EstadoVacio titulo="Sin resultados" texto={`No hay proveedores que coincidan con “${q}”.`} />
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              {lista.map(({ p, ultima }) => {
                const cuerpo = (
                  <>
                    <span className="ib">
                      <Truck className="ic" />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600 }}>{p.nombre}</p>
                      <p className="t-aux">{p.productos || 'Sin productos registrados'}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p className="t-aux">Última compra</p>
                      <p className="t-2 num" style={{ fontWeight: 600, color: 'var(--texto)' }}>
                        {ultima ? formatoRelativo(ultima).replace(/^Hoy .*/, 'Hoy') : '—'}
                      </p>
                    </div>
                    {puede('proveedores.gestionar') && <ChevronRight className="ic" />}
                  </>
                );
                return puede('proveedores.gestionar') ? (
                  <Link key={p.id} className="rowlink" to={`/proveedores/${p.id}/editar`}>
                    {cuerpo}
                  </Link>
                ) : (
                  <div key={p.id} className="rowlink" style={{ cursor: 'default' }}>
                    {cuerpo}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
      {puede('proveedores.gestionar') && (
        <div className="barra-accion">
          <Link className="btn btn-p btn-lg" style={{ flex: 1 }} to="/proveedores/nuevo">
            <Plus className="ic" />
            Agregar proveedor
          </Link>
        </div>
      )}
    </>
  );
}
