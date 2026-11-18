import { useState } from 'react';
import { Link } from 'react-router';
import { Plus, Truck, Warehouse, ChevronRight, Layers, Sparkles } from 'lucide-react';
import { useSesionActiva } from '../../auth/SesionContext';
import { EncabezadoPagina } from '../../layout/Encabezados';
import { useTotalesCargaDelDia } from '../../hooks/useDatosLocales';
import { diaLocal, formatoDia } from '../../lib/fechas';
import { Esqueleto, EstadoVacio } from '../../componentes/Estados';
import { InsigniaSync } from '../../componentes/Insignias';

export default function CargaDelDia() {
  const { puede } = useSesionActiva();
  const hoy = diaLocal();
  const datos = useTotalesCargaDelDia(hoy);
  const [pestana, setPestana] = useState<'clasificacion' | 'origen' | 'cargas'>('clasificacion');

  if (!datos) {
    return (
      <main className="pag-main" style={{ paddingTop: 16 }}>
        <Esqueleto filas={4} />
      </main>
    );
  }

  const { cargado, vendido, queda, porClasificacion, porOrigen, cargas } = datos;

  return (
    <main className="pag-main" style={{ paddingBottom: 80 }}>
      <EncabezadoPagina
        titulo="Carga del día"
        subtitulo={`Operación del ${formatoDia(hoy)}`}
        acciones={
          puede('cargas.registrar') ? (
            <Link to="/carga/nueva" className="btn btn-p" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus className="ic" style={{ width: 18, height: 18 }} />
              Nueva carga
            </Link>
          ) : undefined
        }
      />

      {/* Tarjetas resumen principales */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 20 }}>
        <div className="card" style={{ padding: '16px 14px', background: 'var(--fondo-elevado)' }}>
          <p className="t-2" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Truck className="ic" style={{ width: 16, height: 16, color: 'var(--primario)' }} />
            Total Cargado
          </p>
          <p className="num" style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {cargado.toString()}
          </p>
          <p className="t-aux">Unidades hoy</p>
        </div>

        <div className="card" style={{ padding: '16px 14px', background: 'var(--fondo-elevado)' }}>
          <p className="t-2" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles className="ic" style={{ width: 16, height: 16, color: 'var(--exito-texto)' }} />
            Vendido
          </p>
          <p className="num" style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: 'var(--exito-texto)' }}>
            {vendido.toString()}
          </p>
          <p className="t-aux">Descontado en ventas</p>
        </div>

        <div className="card" style={{ padding: '16px 14px', background: 'var(--fondo-elevado)' }}>
          <p className="t-2" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Warehouse className="ic" style={{ width: 16, height: 16, color: 'var(--acento-texto)' }} />
            Queda
          </p>
          <p className="num" style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: queda.gt(0) ? 'var(--acento-texto)' : 'var(--texto-tenue)' }}>
            {queda.toString()}
          </p>
          <p className="t-aux">Disponible en cargas</p>
        </div>
      </section>

      {/* Selector de vistas */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--borde)', paddingBottom: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setPestana('clasificacion')}
          className={`btn ${pestana === 'clasificacion' ? 'btn-p' : 'btn-s'}`}
          style={{ padding: '6px 14px', fontSize: 14 }}
        >
          Por clasificación
        </button>
        <button
          type="button"
          onClick={() => setPestana('origen')}
          className={`btn ${pestana === 'origen' ? 'btn-p' : 'btn-s'}`}
          style={{ padding: '6px 14px', fontSize: 14 }}
        >
          Por origen
        </button>
        <button
          type="button"
          onClick={() => setPestana('cargas')}
          className={`btn ${pestana === 'cargas' ? 'btn-p' : 'btn-s'}`}
          style={{ padding: '6px 14px', fontSize: 14 }}
        >
          Cargas ({cargas.length})
        </button>
      </div>

      {cargas.length === 0 ? (
        <EstadoVacio
          icono={Truck}
          titulo="Sin cargas registradas hoy"
          texto="Registra la carga del día para controlar lo que ingresa de tus ranchos o consignaciones."
          acciones={
            puede('cargas.registrar') ? (
              <Link to="/carga/nueva" className="btn btn-p">
                Registrar primera carga
              </Link>
            ) : undefined
          }
        />
      ) : pestana === 'clasificacion' ? (
        <section className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--borde)', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', fontWeight: 600, fontSize: 13, color: 'var(--texto-tenue)' }}>
            <span>Clasificación</span>
            <span style={{ textAlign: 'right' }}>Cargado</span>
            <span style={{ textAlign: 'right' }}>Vendido</span>
            <span style={{ textAlign: 'right' }}>Queda</span>
          </div>
          {porClasificacion.map((c) => (
            <div
              key={c.clasificacionId}
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--borde-tenue)',
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr',
                alignItems: 'center',
                fontSize: 14,
              }}
            >
              <div>
                <p style={{ fontWeight: 600 }}>{c.clasificacionNombre}</p>
                <p className="t-aux">{c.productoNombre} ({c.unidadPlural})</p>
              </div>
              <span className="num" style={{ textAlign: 'right' }}>{c.cargado.toString()}</span>
              <span className="num" style={{ textAlign: 'right', color: 'var(--exito-texto)' }}>{c.vendido.toString()}</span>
              <span className="num" style={{ textAlign: 'right', fontWeight: 700, color: c.queda.gt(0) ? 'var(--primario)' : 'var(--texto-tenue)' }}>
                {c.queda.toString()}
              </span>
            </div>
          ))}
        </section>
      ) : pestana === 'origen' ? (
        <section className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--borde)', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', fontWeight: 600, fontSize: 13, color: 'var(--texto-tenue)' }}>
            <span>Origen / Productor</span>
            <span style={{ textAlign: 'right' }}>Cargado</span>
            <span style={{ textAlign: 'right' }}>Vendido</span>
            <span style={{ textAlign: 'right' }}>Queda</span>
          </div>
          {porOrigen.map((o) => (
            <div
              key={o.proveedorId}
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--borde-tenue)',
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr',
                alignItems: 'center',
                fontSize: 14,
              }}
            >
              <div>
                <p style={{ fontWeight: 600 }}>{o.proveedorNombre}</p>
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: 11,
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: o.proveedorTipo === 'rancho_propio' ? 'var(--primario-fondo)' : 'var(--fondo-control)',
                    color: o.proveedorTipo === 'rancho_propio' ? 'var(--primario)' : 'var(--texto-tenue)',
                  }}
                >
                  {o.proveedorTipo === 'rancho_propio' ? 'Rancho propio' : 'Productor (consigna)'}
                </span>
              </div>
              <span className="num" style={{ textAlign: 'right' }}>{o.cargado.toString()}</span>
              <span className="num" style={{ textAlign: 'right', color: 'var(--exito-texto)' }}>{o.vendido.toString()}</span>
              <span className="num" style={{ textAlign: 'right', fontWeight: 700, color: o.queda.gt(0) ? 'var(--primario)' : 'var(--texto-tenue)' }}>
                {o.queda.toString()}
              </span>
            </div>
          ))}
        </section>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cargas.map((cr) => (
            <Link
              key={cr.carga.id}
              to={`/carga/${cr.carga.id}`}
              className="card rowlink"
              style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textDecoration: 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="cuadro-ic" style={{ background: 'var(--primario-fondo)', color: 'var(--primario)' }}>
                  <Layers className="ic" />
                </span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <p style={{ fontWeight: 600, fontSize: 15 }}>{cr.proveedorNombre}</p>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: cr.carga.estado === 'abierta' ? 'var(--exito-fondo)' : 'var(--fondo-control)',
                        color: cr.carga.estado === 'abierta' ? 'var(--exito-texto)' : 'var(--texto-tenue)',
                      }}
                    >
                      {cr.carga.estado === 'abierta' ? 'Abierta' : 'Cerrada'}
                    </span>
                    {cr.sync && <InsigniaSync estado={cr.sync} />}
                  </div>
                  <p className="t-aux" style={{ marginTop: 2 }}>
                    Cargado: {cr.totalCargado.toString()} · Vendido: {cr.totalVendido.toString()} · Queda: {cr.totalQueda.toString()}
                  </p>
                </div>
              </div>
              <ChevronRight className="ic" style={{ color: 'var(--texto-tenue)' }} />
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
