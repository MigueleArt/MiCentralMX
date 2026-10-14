import { useState } from 'react';
import { ElegirEnLista } from '../../componentes/ElegirEnLista';
import { Campo } from '../../componentes/Formulario';
import { HojaInferior } from '../../componentes/Superpuestos';
import type { EstadoVenta } from '@micentralmx/shared/entidades';
import type { ClienteVista, VentaVista } from '../../dominio/consultas';
import { FILTROS_INICIALES, filtrarVentas, type FiltrosVenta, type Periodo } from './filtros';

function Grupo<T extends string>({
  leyenda,
  opciones,
  valor,
  alCambiar,
}: {
  leyenda: string;
  opciones: Array<[T, string]>;
  valor: T | null;
  alCambiar: (v: T | null) => void;
}) {
  return (
    <fieldset className="pila">
      <legend className="flabel" style={{ marginBottom: 8 }}>
        {leyenda}
      </legend>
      <div className="fila" style={{ flexWrap: 'wrap' }}>
        {opciones.map(([v, t]) => (
          <button key={v} type="button" className="chip" aria-pressed={valor === v} onClick={() => alCambiar(valor === v ? null : v)}>
            {t}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Pantalla 06 · Ventas · Filtros (hoja inferior). */
export function FiltrosVentas({
  inicial,
  ventas,
  clientes,
  busqueda,
  alAplicar,
  alCerrar,
}: {
  inicial: FiltrosVenta;
  ventas: VentaVista[];
  clientes: ClienteVista[];
  busqueda: string;
  alAplicar: (f: FiltrosVenta) => void;
  alCerrar: () => void;
}) {
  const [f, setF] = useState(inicial);
  const n = filtrarVentas(ventas, f, busqueda).length;
  return (
    <HojaInferior titulo="Filtrar ventas" alCerrar={alCerrar}>
      <Grupo<Periodo>
        leyenda="Fecha"
        opciones={[
          ['hoy', 'Hoy'],
          ['ayer', 'Ayer'],
          ['semana', 'Esta semana'],
          ['rango', 'Elegir fechas'],
        ]}
        valor={f.periodo === 'todas' ? null : f.periodo}
        alCambiar={(periodo) => setF({ ...f, periodo: periodo ?? 'todas' })}
      />
      {f.periodo === 'rango' && (
        <div className="rejilla-2" style={{ gap: 12 }}>
          <Campo etiqueta="Desde" id="desde">
            <input id="desde" className="inp" type="date" value={f.desde} max={f.hasta} onChange={(e) => setF({ ...f, desde: e.target.value })} />
          </Campo>
          <Campo etiqueta="Hasta" id="hasta">
            <input id="hasta" className="inp" type="date" value={f.hasta} min={f.desde} onChange={(e) => setF({ ...f, hasta: e.target.value })} />
          </Campo>
        </div>
      )}
      <Grupo<EstadoVenta>
        leyenda="Estado"
        opciones={[
          ['completada', 'Completada'],
          ['por_confirmar', 'Por confirmar'],
          ['a_credito', 'Crédito pendiente'],
          ['cancelada', 'Cancelada'],
        ]}
        valor={f.estado}
        alCambiar={(estado) => setF({ ...f, estado })}
      />
      <Grupo<'contado' | 'credito'>
        leyenda="Tipo de pago"
        opciones={[
          ['contado', 'Contado'],
          ['credito', 'Crédito'],
        ]}
        valor={f.tipo}
        alCambiar={(tipo) => setF({ ...f, tipo })}
      />
      <Campo etiqueta="Cliente" id="filtro-cliente">
        <ElegirEnLista
          id="filtro-cliente"
          titulo="Cliente"
          marcador="Todos los clientes"
          valor={f.clienteId ?? ''}
          opciones={[{ valor: '', texto: 'Todos los clientes' }, ...clientes.map((c) => ({ valor: c.cliente.id, texto: c.cliente.nombre, busqueda: c.cliente.telefono ?? '' }))]}
          alElegir={(v) => setF({ ...f, clienteId: v || null })}
        />
      </Campo>
      <div className="rejilla-2" style={{ gap: 12 }}>
        <button type="button" className="btn btn-q" onClick={() => setF({ ...FILTROS_INICIALES, periodo: 'todas' })}>
          Limpiar
        </button>
        <button
          type="button"
          className="btn btn-p"
          onClick={() => {
            alAplicar(f);
            alCerrar();
          }}
        >
          Ver {n} {n === 1 ? 'venta' : 'ventas'}
        </button>
      </div>
    </HojaInferior>
  );
}
