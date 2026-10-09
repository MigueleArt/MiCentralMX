import { CircleAlert, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { AvisoLinea } from '../../componentes/Estados';
import { Campo, Entrada } from '../../componentes/Formulario';
import { HojaInferior } from '../../componentes/Superpuestos';
import type { Cliente } from '@micentralmx/shared/entidades';
import { editarCliente } from '../../dominio/enLinea';
import { ErrorValidacion } from '../../dominio/errores';
import { clientesConTelefono, crearCliente } from '../../dominio/operaciones';
import { useClientes } from '../../hooks/useDatosLocales';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { useConectividad } from '../../sync/conectividad';

interface Valores {
  nombre: string;
  telefono: string;
  ubicacion: string;
  plazo: string;
}

function CamposCliente({ v, set, errores, conPlazo, plazoNegocio }: { v: Valores; set: (v: Valores) => void; errores: Record<string, string>; conPlazo: boolean; plazoNegocio: number }) {
  return (
    <>
      <Campo etiqueta="Nombre o negocio" id="cn" error={errores.nombre}>
        <Entrada id="cn" value={v.nombre} onChange={(e) => set({ ...v, nombre: e.target.value })} placeholder="Ej. Fonda El Comal" error={errores.nombre} autoComplete="off" />
      </Campo>
      <Campo etiqueta="Teléfono" id="ct" opcional error={errores.telefono}>
        <Entrada id="ct" type="tel" inputMode="tel" value={v.telefono} onChange={(e) => set({ ...v, telefono: e.target.value })} placeholder="Ej. 55 1234 5678" error={errores.telefono} />
      </Campo>
      <Campo etiqueta="Ubicación" id="cu" opcional>
        <Entrada id="cu" value={v.ubicacion} onChange={(e) => set({ ...v, ubicacion: e.target.value })} placeholder="Ej. Puesto 112, Nave I" />
      </Campo>
      {conPlazo && (
        <Campo etiqueta="Plazo de crédito (días)" id="cp" opcional error={errores.plazo} ayuda={`Si lo dejas vacío se usa el del negocio: ${plazoNegocio} días.`}>
          <Entrada id="cp" inputMode="numeric" value={v.plazo} onChange={(e) => set({ ...v, plazo: e.target.value.replace(/\D/g, '') })} error={errores.plazo} />
        </Campo>
      )}
    </>
  );
}

function useGuardarNuevo() {
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [duplicados, setDuplicados] = useState<string[] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const guardar = async (v: Valores, confirmarDuplicado: boolean): Promise<Cliente | null> => {
    setErrores({});
    setGeneral(null);
    if (!confirmarDuplicado) {
      const iguales = await clientesConTelefono(v.telefono);
      if (iguales.length) {
        setDuplicados(iguales.map((c) => c.nombre));
        return null;
      }
    }
    setGuardando(true);
    try {
      return await crearCliente({ nombre: v.nombre, telefono: v.telefono || null, ubicacion: v.ubicacion || null, plazoDias: v.plazo ? Number(v.plazo) : null });
    } catch (e) {
      if (e instanceof ErrorValidacion && e.campo) setErrores({ [e.campo]: e.message });
      else setGeneral(mensajeError(e));
      return null;
    } finally {
      setGuardando(false);
      setDuplicados(null);
    }
  };
  return { errores, general, duplicados, guardando, guardar, setDuplicados };
}

function AvisoDuplicado({ nombres, alConfirmar, alCancelar }: { nombres: string[]; alConfirmar: () => void; alCancelar: () => void }) {
  return (
    <AvisoLinea tono="warn" icono={<TriangleAlert className="ic" />}>
      <strong>Ya existe un cliente con ese teléfono</strong>
      {nombres.join(', ')}. Si es otra persona, guárdalo de todos modos; el servidor lo marcará para revisión.
      <span className="fila" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-q btn-sm" onClick={alCancelar}>
          Revisar
        </button>
        <button type="button" className="btn btn-a btn-sm" onClick={alConfirmar}>
          Guardar de todos modos
        </button>
      </span>
    </AvisoLinea>
  );
}

/** Alta rápida de cliente desde Nueva venta o Registrar pago (funciona sin conexión). */
export function AltaRapidaCliente({ nombreInicial, alCrear, alCerrar }: { nombreInicial?: string; alCrear: (c: Cliente) => void; alCerrar: () => void }) {
  const [v, setV] = useState<Valores>({ nombre: nombreInicial ?? '', telefono: '', ubicacion: '', plazo: '' });
  const g = useGuardarNuevo();
  const enviar = async (confirmar = false) => {
    const c = await g.guardar(v, confirmar);
    if (c) alCrear(c);
  };
  return (
    <HojaInferior titulo="Agregar cliente" alCerrar={alCerrar}>
      <form className="pila-16" onSubmit={(e) => { e.preventDefault(); void enviar(); }} noValidate>
        <CamposCliente v={v} set={setV} errores={g.errores} conPlazo={false} plazoNegocio={0} />
        {g.duplicados && <AvisoDuplicado nombres={g.duplicados} alConfirmar={() => void enviar(true)} alCancelar={() => g.setDuplicados(null)} />}
        {g.general && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{g.general}</AvisoLinea>}
        <button type="submit" className="btn btn-p" disabled={g.guardando}>
          Agregar cliente
        </button>
      </form>
    </HojaInferior>
  );
}

/** Agregar (sin conexión) y editar (en línea) cliente. */
export default function FormCliente() {
  const { id } = useParams();
  const navegar = useNavigate();
  const avisar = useAvisos();
  const { sesion, puede } = useSesionActiva();
  const { enLinea } = useConectividad();
  const clientes = useClientes();
  const existente = id ? clientes?.find((c) => c.cliente.id === id)?.cliente : undefined;
  const [v, setV] = useState<Valores | null>(id ? null : { nombre: '', telefono: '', ubicacion: '', plazo: '' });
  const g = useGuardarNuevo();
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  if (id && existente && !v) {
    setV({ nombre: existente.nombre, telefono: existente.telefono ?? '', ubicacion: existente.ubicacion ?? '', plazo: existente.plazoDias ? String(existente.plazoDias) : '' });
  }
  if (!v) return <EncabezadoSecundario titulo="Editar cliente" cerrar />;

  const enviar = async (e?: FormEvent, confirmar = false) => {
    e?.preventDefault();
    if (!id) {
      const c = await g.guardar(v, confirmar);
      if (c) {
        avisar(enLinea ? 'Cliente agregado' : 'Cliente guardado en este dispositivo');
        navegar(`/clientes/${c.id}`, { replace: true });
      }
      return;
    }
    // Editar cliente es solo en línea (decisiones técnicas §4.5).
    setGuardandoEdicion(true);
    setErrorEdicion(null);
    try {
      await editarCliente(id, { nombre: v.nombre.trim(), telefono: v.telefono.trim() || null, ubicacion: v.ubicacion.trim() || null, plazoDias: v.plazo ? Number(v.plazo) : null });
      avisar('Cliente actualizado');
      navegar(`/clientes/${id}`, { replace: true });
    } catch (err) {
      setErrorEdicion(mensajeError(err));
    } finally {
      setGuardandoEdicion(false);
    }
  };

  const puedeEditar = !id || (puede('clientes.editar') && enLinea);
  return (
    <>
      <EncabezadoSecundario titulo={id ? 'Editar cliente' : 'Agregar cliente'} cerrar volverA={id ? `/clientes/${id}` : '/clientes'} />
      <main className="pag-main con-enc-sec">
        <form className="pila-16 contenedor-form" onSubmit={(e) => void enviar(e)} noValidate>
          {id && !enLinea && (
            <AvisoLinea tono="warn" icono={<CircleAlert className="ic" />}>
              Editar un cliente necesita conexión. Puedes agregar clientes nuevos sin Internet.
            </AvisoLinea>
          )}
          {id && !puede('clientes.editar') && (
            <AvisoLinea tono="info">Tu rol no permite editar clientes.</AvisoLinea>
          )}
          <CamposCliente v={v} set={setV} errores={g.errores} conPlazo plazoNegocio={sesion.configuracion.plazoCreditoDias} />
          {g.duplicados && <AvisoDuplicado nombres={g.duplicados} alConfirmar={() => void enviar(undefined, true)} alCancelar={() => g.setDuplicados(null)} />}
          {(g.general || errorEdicion) && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{g.general ?? errorEdicion}</AvisoLinea>}
          <button type="submit" className="btn btn-p btn-lg" disabled={!puedeEditar || g.guardando || guardandoEdicion}>
            {guardandoEdicion && <LoaderCircle className="ic girar" />}
            {id ? 'Guardar cambios' : 'Guardar cliente'}
          </button>
        </form>
      </main>
    </>
  );
}
