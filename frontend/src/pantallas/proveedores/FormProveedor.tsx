import { useLiveQuery } from 'dexie-react-hooks';
import { CircleAlert, LoaderCircle, WifiOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { mensajeError } from '../../api/cliente';
import { useAvisos } from '../../componentes/Avisos';
import { AvisoLinea } from '../../componentes/Estados';
import { Campo, Entrada } from '../../componentes/Formulario';
import { db } from '../../db/db';
import { crearProveedor, editarProveedor } from '../../dominio/enLinea';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { useConectividad } from '../../sync/conectividad';

/** Agregar y editar proveedor (solo en línea). Complementa la pantalla 22. */
export default function FormProveedor() {
  const { id } = useParams();
  const navegar = useNavigate();
  const avisar = useAvisos();
  const { enLinea } = useConectividad();
  const existente = useLiveQuery(async () => (id ? ((await db.proveedores.get(id)) ?? null) : null), [id]);
  const [v, setV] = useState<{
    nombre: string;
    telefono: string;
    productos: string;
    tipo: 'tercero' | 'rancho_propio';
    comisionTipo: 'porcentaje' | 'por_unidad' | null;
    comisionValor: string;
  } | null>(
    id ? null : { nombre: '', telefono: '', productos: '', tipo: 'tercero', comisionTipo: null, comisionValor: '' },
  );
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  if (id && existente && !v) {
    setV({
      nombre: existente.nombre,
      telefono: existente.telefono ?? '',
      productos: existente.productos,
      tipo: existente.tipo ?? 'tercero',
      comisionTipo: existente.comisionTipo ?? null,
      comisionValor: existente.comisionValor ?? '',
    });
  }
  if (!v) return <EncabezadoSecundario titulo="Editar origen" cerrar volverA="/proveedores" />;

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.nombre.trim()) {
      setError('Escribe el nombre del proveedor o rancho.');
      return;
    }
    setGuardando(true);
    setError(null);
    const datos = {
      nombre: v.nombre.trim(),
      telefono: v.telefono.trim() || null,
      productos: v.productos.trim(),
      tipo: v.tipo,
      comisionTipo: v.tipo === 'tercero' ? v.comisionTipo : null,
      comisionValor: v.tipo === 'tercero' && v.comisionTipo ? v.comisionValor.trim() || null : null,
    };
    try {
      if (id) await editarProveedor(id, datos);
      else await crearProveedor(datos);
      avisar(id ? 'Origen actualizado' : 'Origen agregado');
      navegar('/proveedores', { replace: true });
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <EncabezadoSecundario titulo={id ? 'Editar proveedor o rancho' : 'Agregar proveedor o rancho'} cerrar volverA="/proveedores" />
      <main className="pag-main con-enc-sec">
        <form className="pila-16 contenedor-form" style={{ margin: '0 auto' }} onSubmit={(e) => void guardar(e)} noValidate>
          {!enLinea && (
            <AvisoLinea tono="warn" icono={<WifiOff className="ic" />}>
              Agregar o editar proveedores y ranchos necesita conexión.
            </AvisoLinea>
          )}
          <Campo etiqueta="Tipo de origen" id="ptipo">
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 15 }}>
                <input
                  type="radio"
                  name="tipo"
                  value="tercero"
                  checked={v.tipo === 'tercero'}
                  onChange={() => setV({ ...v, tipo: 'tercero' })}
                />
                Productor externo (consigna / tercero)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 15 }}>
                <input
                  type="radio"
                  name="tipo"
                  value="rancho_propio"
                  checked={v.tipo === 'rancho_propio'}
                  onChange={() => setV({ ...v, tipo: 'rancho_propio', comisionTipo: null, comisionValor: '' })}
                />
                Rancho propio
              </label>
            </div>
          </Campo>
          <Campo etiqueta="Nombre" id="pn">
            <Entrada id="pn" value={v.nombre} onChange={(e) => setV({ ...v, nombre: e.target.value })} placeholder="Ej. Rancho La Joya o Don Ale" />
          </Campo>
          {v.tipo === 'tercero' && (
            <div className="card pila-12" style={{ padding: 12, background: 'var(--fondo-superficie)' }}>
              <p style={{ fontWeight: 600, fontSize: 14 }}>Comisión sugerida por omisión</p>
              <p className="t-aux" style={{ fontSize: 13 }}>
                Se sugerirá automáticamente al registrar cargas o hacer cortes para este productor.
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="radio"
                    name="comisionTipo"
                    checked={v.comisionTipo === null}
                    onChange={() => setV({ ...v, comisionTipo: null, comisionValor: '' })}
                  />
                  Sin comisión fija
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="radio"
                    name="comisionTipo"
                    checked={v.comisionTipo === 'porcentaje'}
                    onChange={() => setV({ ...v, comisionTipo: 'porcentaje' })}
                  />
                  Porcentaje (%)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="radio"
                    name="comisionTipo"
                    checked={v.comisionTipo === 'por_unidad'}
                    onChange={() => setV({ ...v, comisionTipo: 'por_unidad' })}
                  />
                  Por unidad ($ / caja o tara)
                </label>
              </div>
              {v.comisionTipo && (
                <Campo
                  etiqueta={v.comisionTipo === 'porcentaje' ? 'Porcentaje de comisión (%)' : 'Monto de comisión por unidad ($)'}
                  id="pcom"
                >
                  <Entrada
                    id="pcom"
                    type="number"
                    step="any"
                    value={v.comisionValor}
                    onChange={(e) => setV({ ...v, comisionValor: e.target.value })}
                    placeholder={v.comisionTipo === 'porcentaje' ? 'Ej. 10 para 10%' : 'Ej. 5.00 por caja'}
                  />
                </Campo>
              )}
            </div>
          )}
          <Campo etiqueta="Teléfono" id="pt" opcional>
            <Entrada id="pt" type="tel" value={v.telefono} onChange={(e) => setV({ ...v, telefono: e.target.value })} />
          </Campo>
          <Campo etiqueta="Qué surte" id="pp" opcional>
            <Entrada id="pp" value={v.productos} onChange={(e) => setV({ ...v, productos: e.target.value })} placeholder="Ej. Jitomate, chile serrano" />
          </Campo>
          {error && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{error}</AvisoLinea>}
          <button type="submit" className="btn btn-p btn-lg" disabled={!enLinea || guardando}>
            {guardando && <LoaderCircle className="ic girar" />}
            {id ? 'Guardar cambios' : 'Guardar origen'}
          </button>
        </form>
      </main>
    </>
  );
}
