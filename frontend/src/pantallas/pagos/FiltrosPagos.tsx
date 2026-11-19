import { useState } from 'react';
import type { MetodoPago } from '@micentralmx/shared/entidades';
import { Campo } from '../../componentes/Formulario';
import { HojaInferior } from '../../componentes/Superpuestos';
import { ETIQUETA_METODO } from '../../dominio/formato';
import {
  ETIQUETAS_CATEGORIA_PAGO,
  ETIQUETAS_ORDEN_PAGOS,
  crearFiltrosPagosIniciales,
  filtrarMovimientosPago,
  type CategoriaMovimientoPago,
  type FiltrosPagos as TipoFiltrosPagos,
  type MovimientoPagoVista,
  type OrdenPagos,
  type PeriodoPagos,
  type TipoMovimientoFiltro,
} from './filtros';

function GrupoChips<T extends string>({
  leyenda,
  opciones,
  valor,
  alCambiar,
}: {
  leyenda: string;
  opciones: Array<[T, string]>;
  valor: T | null;
  alCambiar: (v: T) => void;
}) {
  return (
    <fieldset className="pila">
      <legend className="flabel" style={{ marginBottom: 8 }}>
        {leyenda}
      </legend>
      <div className="fila" style={{ flexWrap: 'wrap' }}>
        {opciones.map(([v, t]) => (
          <button key={v} type="button" className="chip" aria-pressed={valor === v} onClick={() => alCambiar(v)}>
            {t}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const OPCIONES_PERIODO: Array<[PeriodoPagos, string]> = [
  ['todos', 'Todos'],
  ['hoy', 'Hoy'],
  ['ayer', 'Ayer'],
  ['semana', 'Esta semana'],
  ['mes', 'Este mes'],
  ['rango', 'Elegir fechas'],
];

const OPCIONES_TIPO: Array<[TipoMovimientoFiltro, string]> = [
  ['todos', 'Todos'],
  ['ingreso', 'Ingresos'],
  ['egreso', 'Egresos'],
];

const OPCIONES_METODO = (['efectivo', 'transferencia', 'otro'] as MetodoPago[]).map(
  (m): [MetodoPago, string] => [m, ETIQUETA_METODO[m]],
);

const OPCIONES_CATEGORIA = (Object.keys(ETIQUETAS_CATEGORIA_PAGO) as CategoriaMovimientoPago[]).map(
  (c): [CategoriaMovimientoPago, string] => [c, ETIQUETAS_CATEGORIA_PAGO[c]],
);

const OPCIONES_ORDEN = (Object.keys(ETIQUETAS_ORDEN_PAGOS) as OrdenPagos[]).map(
  (o): [OrdenPagos, string] => [o, ETIQUETAS_ORDEN_PAGOS[o]],
);

/** Hoja inferior de filtros avanzados para la pantalla de Pagos. */
export function FiltrosPagos({
  inicial,
  movimientos,
  busqueda,
  alAplicar,
  alCerrar,
}: {
  inicial: TipoFiltrosPagos;
  movimientos: MovimientoPagoVista[];
  busqueda: string;
  alAplicar: (f: TipoFiltrosPagos) => void;
  alCerrar: () => void;
}) {
  const [f, setF] = useState<TipoFiltrosPagos>(inicial);
  const n = filtrarMovimientosPago(movimientos, f, busqueda).length;

  return (
    <HojaInferior titulo="Filtrar pagos" alCerrar={alCerrar}>
      <GrupoChips<PeriodoPagos>
        leyenda="Periodo"
        opciones={OPCIONES_PERIODO}
        valor={f.periodo}
        alCambiar={(periodo) => setF({ ...f, periodo: f.periodo === periodo && periodo !== 'todos' ? 'todos' : periodo })}
      />
      {f.periodo === 'rango' && (
        <div className="rejilla-2" style={{ gap: 12 }}>
          <Campo etiqueta="Desde" id="pagos-desde">
            <input
              id="pagos-desde"
              className="inp"
              type="date"
              value={f.desde}
              max={f.hasta}
              onChange={(e) => setF({ ...f, desde: e.target.value })}
            />
          </Campo>
          <Campo etiqueta="Hasta" id="pagos-hasta">
            <input
              id="pagos-hasta"
              className="inp"
              type="date"
              value={f.hasta}
              min={f.desde}
              onChange={(e) => setF({ ...f, hasta: e.target.value })}
            />
          </Campo>
        </div>
      )}
      <GrupoChips<TipoMovimientoFiltro>
        leyenda="Tipo"
        opciones={OPCIONES_TIPO}
        valor={f.tipo}
        alCambiar={(tipo) => setF({ ...f, tipo: f.tipo === tipo && tipo !== 'todos' ? 'todos' : tipo })}
      />
      <GrupoChips<MetodoPago>
        leyenda="Método de pago"
        opciones={OPCIONES_METODO}
        valor={f.metodo}
        alCambiar={(metodo) => setF({ ...f, metodo: f.metodo === metodo ? null : metodo })}
      />
      <GrupoChips<CategoriaMovimientoPago>
        leyenda="Categoría"
        opciones={OPCIONES_CATEGORIA}
        valor={f.categoria}
        alCambiar={(categoria) => setF({ ...f, categoria: f.categoria === categoria ? null : categoria })}
      />
      <GrupoChips<OrdenPagos>
        leyenda="Ordenar por"
        opciones={OPCIONES_ORDEN}
        valor={f.orden}
        alCambiar={(orden) => setF({ ...f, orden })}
      />
      <div className="rejilla-2" style={{ gap: 12 }}>
        <button type="button" className="btn btn-q" onClick={() => setF(crearFiltrosPagosIniciales())}>
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
          Ver {n} {n === 1 ? 'movimiento' : 'movimientos'}
        </button>
      </div>
    </HojaInferior>
  );
}
