import { BadgeDollarSign, CircleAlert, Contact, LoaderCircle, MapPin, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { Cliente } from '@micentralmx/shared/entidades';
import { mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { AvisoLinea, EstadoVacio } from '../../componentes/Estados';
import { Campo, Entrada } from '../../componentes/Formulario';
import { HojaInferior } from '../../componentes/Superpuestos';
import { validarClienteFormulario, type DatosClienteFormulario } from '../../dominio/clientes';
import { editarCliente } from '../../dominio/enLinea';
import { ErrorValidacion } from '../../dominio/errores';
import { clientesConTelefono, crearCliente } from '../../dominio/operaciones';
import { useClientes } from '../../hooks/useDatosLocales';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { useConectividad } from '../../sync/conectividad';
import './clientes.css';

type Valores = DatosClienteFormulario;
const vacio: Valores = { nombre: '', telefono: '', ubicacion: '', plazo: '' };

function CamposContacto({ v, set, errores }: { v: Valores; set: (v: Valores) => void; errores: Record<string, string> }) {
  return (
    <div className="cliente-form-grid dos-columnas">
      <Campo etiqueta="Nombre o negocio" id="cn" error={errores.nombre}>
        <Entrada
          id="cn"
          value={v.nombre}
          onChange={(e) => set({ ...v, nombre: e.target.value })}
          placeholder="Ej. Fonda El Comal"
          error={errores.nombre}
          autoComplete="name"
          maxLength={160}
          autoFocus
        />
      </Campo>
      <Campo etiqueta="Teléfono" id="ct" opcional error={errores.telefono} ayuda="Se usa para contacto y para detectar registros duplicados.">
        <Entrada
          id="ct"
          type="tel"
          inputMode="tel"
          value={v.telefono}
          onChange={(e) => set({ ...v, telefono: e.target.value })}
          placeholder="Ej. 55 1234 5678"
          error={errores.telefono}
          autoComplete="tel"
          maxLength={30}
        />
      </Campo>
      <div style={{ gridColumn: '1 / -1' }}>
        <Campo etiqueta="Ubicación o referencia" id="cu" opcional error={errores.ubicacion} ayuda="Puesto, nave, colonia o referencia para identificar al cliente.">
          <Entrada
            id="cu"
            value={v.ubicacion}
            onChange={(e) => set({ ...v, ubicacion: e.target.value })}
            placeholder="Ej. Puesto 112, Nave I"
            error={errores.ubicacion}
            autoComplete="address-line1"
            maxLength={200}
          />
        </Campo>
      </div>
    </div>
  );
}

function CampoPlazo({ v, set, error, plazoNegocio }: { v: Valores; set: (v: Valores) => void; error?: string; plazoNegocio: number }) {
  const efectivo = v.plazo ? Number(v.plazo) : plazoNegocio;
  return (
    <div className="cliente-form-grid">
      <Campo etiqueta="Plazo de crédito" id="cp" opcional error={error} ayuda={`Vacío utiliza la configuración general de ${plazoNegocio} días.`}>
        <Entrada
          id="cp"
          inputMode="numeric"
          value={v.plazo}
          onChange={(e) => set({ ...v, plazo: e.target.value.replace(/\D/g, '').slice(0, 3) })}
          placeholder={`${plazoNegocio} días (predeterminado)`}
          error={error}
        />
      </Campo>
      <div className="cliente-plazos" aria-label="Plazos rápidos">
        <button type="button" className="chip" aria-pressed={!v.plazo} onClick={() => set({ ...v, plazo: '' })}>General · {plazoNegocio} días</button>
        {[7, 15, 30, 60].map((dias) => (
          <button key={dias} type="button" className="chip" aria-pressed={v.plazo === String(dias)} onClick={() => set({ ...v, plazo: String(dias) })}>{dias} días</button>
        ))}
      </div>
      <p className="cliente-form-resumen"><strong>Condición efectiva:</strong> las nuevas ventas a crédito propondrán un vencimiento de {efectivo} días.</p>
    </div>
  );
}

function useGuardarNuevo() {
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [duplicados, setDuplicados] = useState<string[] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const guardar = async (v: Valores, confirmarDuplicado: boolean): Promise<Cliente | null> => {
    const validacion = validarClienteFormulario(v);
    setErrores(validacion);
    setGeneral(null);
    if (Object.keys(validacion).length) return null;
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
      <div>
        <strong>Ya existe un cliente con ese teléfono</strong>
        <p>{nombres.join(', ')}. Confirma únicamente si corresponde a otra persona o negocio.</p>
        <span className="fila" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-q btn-sm" onClick={alCancelar}>Revisar datos</button>
          <button type="button" className="btn btn-a btn-sm" onClick={alConfirmar}>Guardar de todos modos</button>
        </span>
      </div>
    </AvisoLinea>
  );
}

/** Alta rápida de cliente desde Nueva venta o Registrar pago. */
export function AltaRapidaCliente({ nombreInicial, alCrear, alCerrar }: { nombreInicial?: string; alCrear: (c: Cliente) => void; alCerrar: () => void }) {
  const [v, setV] = useState<Valores>({ ...vacio, nombre: nombreInicial ?? '' });
  const g = useGuardarNuevo();
  const enviar = async (confirmar = false) => {
    const c = await g.guardar(v, confirmar);
    if (c) alCrear(c);
  };
  return (
    <HojaInferior titulo="Agregar cliente" alCerrar={alCerrar}>
      <form className="pila-16" onSubmit={(e) => { e.preventDefault(); void enviar(); }} noValidate>
        <CamposContacto v={v} set={setV} errores={g.errores} />
        {g.duplicados && <AvisoDuplicado nombres={g.duplicados} alConfirmar={() => void enviar(true)} alCancelar={() => g.setDuplicados(null)} />}
        {g.general && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{g.general}</AvisoLinea>}
        <button type="submit" className="btn btn-p" disabled={g.guardando}>
          {g.guardando && <LoaderCircle className="ic girar" />} Agregar cliente
        </button>
      </form>
    </HojaInferior>
  );
}

/** Agregar sin conexión y editar en línea un cliente. */
export default function FormCliente() {
  const { id } = useParams();
  const navegar = useNavigate();
  const avisar = useAvisos();
  const { sesion, puede } = useSesionActiva();
  const { enLinea } = useConectividad();
  const clientes = useClientes();
  const existente = id ? clientes?.find((c) => c.cliente.id === id)?.cliente : undefined;
  const [v, setV] = useState<Valores | null>(id ? null : vacio);
  const [inicial, setInicial] = useState<Valores | null>(id ? null : vacio);
  const [erroresEdicion, setErroresEdicion] = useState<Record<string, string>>({});
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const g = useGuardarNuevo();

  useEffect(() => {
    if (!id || !existente || v) return;
    const valores = {
      nombre: existente.nombre,
      telefono: existente.telefono ?? '',
      ubicacion: existente.ubicacion ?? '',
      plazo: existente.plazoDias ? String(existente.plazoDias) : '',
    };
    setV(valores);
    setInicial(valores);
  }, [existente, id, v]);

  if (id && clientes && !existente) {
    return (
      <>
        <EncabezadoSecundario titulo="Editar cliente" cerrar volverA="/clientes" />
        <main className="pag-main con-enc-sec"><EstadoVacio titulo="No encontramos al cliente" texto="Vuelve al directorio e inténtalo de nuevo." /></main>
      </>
    );
  }
  if (!v) return <EncabezadoSecundario titulo="Editar cliente" cerrar volverA={id ? `/clientes/${id}` : '/clientes'} />;

  const sinCambios = !!id && JSON.stringify(v) === JSON.stringify(inicial);
  const errores = id ? erroresEdicion : g.errores;
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

    const validacion = validarClienteFormulario(v);
    setErroresEdicion(validacion);
    setErrorEdicion(null);
    if (Object.keys(validacion).length) return;
    if (!confirmar) {
      const iguales = (await clientesConTelefono(v.telefono)).filter((c) => c.id !== id);
      if (iguales.length) {
        g.setDuplicados(iguales.map((c) => c.nombre));
        return;
      }
    }
    setGuardandoEdicion(true);
    try {
      await editarCliente(id, { nombre: v.nombre.trim(), telefono: v.telefono.trim() || null, ubicacion: v.ubicacion.trim() || null, plazoDias: v.plazo ? Number(v.plazo) : null });
      avisar('Cliente actualizado');
      navegar(`/clientes/${id}`, { replace: true });
    } catch (err) {
      setErrorEdicion(mensajeError(err));
    } finally {
      setGuardandoEdicion(false);
      g.setDuplicados(null);
    }
  };

  const puedeGuardar = !id || (puede('clientes.editar') && enLinea && !sinCambios);
  return (
    <>
      <EncabezadoSecundario titulo={id ? 'Editar cliente' : 'Agregar cliente'} cerrar volverA={id ? `/clientes/${id}` : '/clientes'} />
      <main className="pag-main con-enc-sec">
        <form className="pila-16 cliente-formulario" onSubmit={(e) => void enviar(e)} noValidate>
          {id && !enLinea && <AvisoLinea tono="warn" icono={<CircleAlert className="ic" />}>Editar un cliente necesita conexión. Puedes consultar su información mientras vuelves a conectarte.</AvisoLinea>}
          {id && !puede('clientes.editar') && <AvisoLinea tono="info">Tu rol no permite editar clientes.</AvisoLinea>}

          <section className="card cliente-form-seccion">
            <div className="cliente-form-titulo">
              <span className="cuadro-ic"><Contact className="ic" /></span>
              <div><h2>Identificación y contacto</h2><p>Información para encontrar y reconocer al cliente.</p></div>
            </div>
            <CamposContacto v={v} set={setV} errores={errores} />
          </section>

          <section className="card cliente-form-seccion">
            <div className="cliente-form-titulo">
              <span className="cuadro-ic"><BadgeDollarSign className="ic" /></span>
              <div><h2>Condiciones de crédito</h2><p>Define el vencimiento sugerido para sus ventas a crédito.</p></div>
            </div>
            <CampoPlazo v={v} set={setV} error={errores.plazo} plazoNegocio={sesion.configuracion.plazoCreditoDias} />
          </section>

          <section className="card cliente-form-seccion">
            <div className="cliente-form-titulo">
              <span className="cuadro-ic"><MapPin className="ic" /></span>
              <div><h2>Antes de guardar</h2><p>Los campos opcionales pueden completarse posteriormente.</p></div>
            </div>
            <p className="cliente-form-resumen">Se guardará como <strong>{v.nombre.trim() || 'cliente sin nombre'}</strong>{v.telefono.trim() ? ` · ${v.telefono.trim()}` : ' · sin teléfono'}.</p>
          </section>

          {g.duplicados && <AvisoDuplicado nombres={g.duplicados} alConfirmar={() => void enviar(undefined, true)} alCancelar={() => g.setDuplicados(null)} />}
          {(g.general || errorEdicion) && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{g.general ?? errorEdicion}</AvisoLinea>}
          <div className="cliente-form-acciones">
            <button type="button" className="btn btn-q btn-lg" onClick={() => navegar(id ? `/clientes/${id}` : '/clientes')}>Cancelar</button>
            <button type="submit" className="btn btn-p btn-lg" disabled={!puedeGuardar || g.guardando || guardandoEdicion}>
              {(g.guardando || guardandoEdicion) && <LoaderCircle className="ic girar" />}
              {id ? (sinCambios ? 'Sin cambios' : 'Guardar cambios') : 'Guardar cliente'}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
