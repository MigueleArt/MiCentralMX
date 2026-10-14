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
  const [v, setV] = useState<{ nombre: string; telefono: string; productos: string } | null>(id ? null : { nombre: '', telefono: '', productos: '' });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  if (id && existente && !v) setV({ nombre: existente.nombre, telefono: existente.telefono ?? '', productos: existente.productos });
  if (!v) return <EncabezadoSecundario titulo="Editar proveedor" cerrar volverA="/proveedores" />;

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.nombre.trim()) {
      setError('Escribe el nombre del proveedor.');
      return;
    }
    setGuardando(true);
    setError(null);
    const datos = { nombre: v.nombre.trim(), telefono: v.telefono.trim() || null, productos: v.productos.trim() };
    try {
      if (id) await editarProveedor(id, datos);
      else await crearProveedor(datos);
      avisar(id ? 'Proveedor actualizado' : 'Proveedor agregado');
      navegar('/proveedores', { replace: true });
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <EncabezadoSecundario titulo={id ? 'Editar proveedor' : 'Agregar proveedor'} cerrar volverA="/proveedores" />
      <main className="pag-main con-enc-sec">
        <form className="pila-16 contenedor-form" style={{ margin: '0 auto' }} onSubmit={(e) => void guardar(e)} noValidate>
          {!enLinea && (
            <AvisoLinea tono="warn" icono={<WifiOff className="ic" />}>
              Agregar o editar proveedores necesita conexión.
            </AvisoLinea>
          )}
          <Campo etiqueta="Nombre" id="pn">
            <Entrada id="pn" value={v.nombre} onChange={(e) => setV({ ...v, nombre: e.target.value })} placeholder="Ej. Agrícola San Juan" />
          </Campo>
          <Campo etiqueta="Teléfono" id="pt" opcional>
            <Entrada id="pt" type="tel" value={v.telefono} onChange={(e) => setV({ ...v, telefono: e.target.value })} />
          </Campo>
          <Campo etiqueta="Qué surte" id="pp" opcional>
            <Entrada id="pp" value={v.productos} onChange={(e) => setV({ ...v, productos: e.target.value })} placeholder="Ej. Jitomate, chile serrano" />
          </Campo>
          {error && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{error}</AvisoLinea>}
          <button type="submit" className="btn btn-p btn-lg" disabled={!enLinea || guardando}>
            {guardando && <LoaderCircle className="ic girar" />}
            {id ? 'Guardar cambios' : 'Guardar proveedor'}
          </button>
        </form>
      </main>
    </>
  );
}
