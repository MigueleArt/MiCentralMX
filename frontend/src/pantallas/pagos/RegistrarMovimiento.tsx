import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { ElegirEnLista } from '../../componentes/ElegirEnLista';
import { AvisoLinea } from '../../componentes/Estados';
import { Campo, EntradaImporte, Segmentado } from '../../componentes/Formulario';
import { HojaInferior } from '../../componentes/Superpuestos';
import type { CategoriaDinero, MetodoPago } from '@micentralmx/shared/entidades';
import { ErrorAlmacenamiento, ErrorValidacion } from '../../dominio/errores';
import { CATEGORIAS_DINERO } from '../../dominio/formato';
import { registrarMovimientoDinero } from '../../dominio/operaciones';
import { useProveedores } from '../../hooks/useDatosLocales';
import { formatoMXN } from '../../lib/dinero';
import { useConectividad } from '../../sync/conectividad';

/** Registrar ingreso o egreso simple (funciona sin conexión). Complementa la pantalla 25. */
export function RegistrarMovimiento({ alCerrar, alRegistrar }: { alCerrar: () => void; alRegistrar: (texto: string) => void }) {
  const { soloLectura } = useSesionActiva();
  const { enLinea } = useConectividad();
  const proveedores = useProveedores() ?? [];
  const [tipo, setTipo] = useState<'egreso' | 'ingreso'>('egreso');
  const [categoria, setCategoria] = useState<CategoriaDinero>('pago_proveedor');
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const categorias = (Object.entries(CATEGORIAS_DINERO) as Array<[CategoriaDinero, (typeof CATEGORIAS_DINERO)[CategoriaDinero]]>).filter(([, c]) => c.tipo === tipo);

  const guardar = async () => {
    setErrores({});
    setError(null);
    setGuardando(true);
    try {
      const m = await registrarMovimientoDinero({ categoria, concepto, monto, metodo, proveedorId });
      alRegistrar(`${m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} de ${formatoMXN(m.monto)} ${enLinea ? 'registrado' : 'guardado en este dispositivo'}`);
    } catch (e) {
      if (e instanceof ErrorValidacion && e.campo) setErrores({ [e.campo]: e.message });
      else if (e instanceof ErrorAlmacenamiento) setError('No se pudo guardar en este dispositivo; el almacenamiento del navegador no respondió.');
      else setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <HojaInferior titulo="Registrar movimiento" alCerrar={alCerrar}>
      <Segmentado<'egreso' | 'ingreso'>
        etiqueta="Tipo"
        valor={tipo}
        alCambiar={(t) => {
          setTipo(t);
          setCategoria(t === 'egreso' ? 'pago_proveedor' : 'otro_ingreso');
        }}
        opciones={[
          { valor: 'egreso', texto: 'Egreso' },
          { valor: 'ingreso', texto: 'Ingreso' },
        ]}
      />
      <Campo etiqueta="Concepto" id="cat">
        <ElegirEnLista id="cat" titulo="Concepto" valor={categoria} opciones={categorias.map(([v, c]) => ({ valor: v, texto: c.nombre }))} alElegir={(v) => setCategoria(v as CategoriaDinero)} conBusqueda={false} />
      </Campo>
      {categoria === 'pago_proveedor' ? (
        <Campo etiqueta="Proveedor" id="prov" error={errores.proveedor}>
          <ElegirEnLista id="prov" titulo="Proveedor" marcador="Elegir proveedor" valor={proveedorId} opciones={proveedores.map((p) => ({ valor: p.id, texto: p.nombre }))} alElegir={setProveedorId} invalido={!!errores.proveedor} />
        </Campo>
      ) : (
        <Campo etiqueta="Descripción" id="desc" opcional>
          <input id="desc" className="inp" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder={tipo === 'ingreso' ? 'Ej. Renta de diablitos' : 'Ej. Flete de mercancía'} />
        </Campo>
      )}
      <Campo etiqueta="Monto" id="monto" error={errores.monto}>
        <EntradaImporte id="monto" grande valor={monto} alCambiar={setMonto} placeholder="0" error={errores.monto} />
      </Campo>
      <Segmentado<MetodoPago>
        etiqueta="Método"
        valor={metodo}
        alCambiar={setMetodo}
        opciones={[
          { valor: 'efectivo', texto: 'Efectivo' },
          { valor: 'transferencia', texto: 'Transferencia' },
          { valor: 'otro', texto: 'Otro' },
        ]}
      />
      {error && (
        <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>
          {error}
        </AvisoLinea>
      )}
      <div className="pila">
        <button type="button" className="btn btn-p btn-lg" disabled={guardando || soloLectura || !monto} onClick={() => void guardar()}>
          Registrar {tipo}
        </button>
        <button type="button" className="btn btn-q" onClick={alCerrar}>
          Cancelar
        </button>
      </div>
    </HojaInferior>
  );
}
