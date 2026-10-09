import { CircleAlert, Minus, Plus, Search, X } from 'lucide-react';
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { D } from '../lib/dinero';

export function Campo({
  etiqueta,
  ayuda,
  error,
  opcional,
  children,
  id,
}: {
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  error?: string | null;
  opcional?: boolean;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="flabel" htmlFor={id}>
        {etiqueta}
        {opcional && <span className="t-aux" style={{ fontWeight: 500 }}> (opcional)</span>}
      </label>
      {children}
      {error ? (
        <p className="err-msg" id={`${id}-error`}>
          <CircleAlert className="ic" style={{ width: 16, height: 16 }} />
          {error}
        </p>
      ) : (
        ayuda && <p className="hint">{ayuda}</p>
      )}
    </div>
  );
}

export function Entrada({ error, ...props }: InputHTMLAttributes<HTMLInputElement> & { error?: string | null }) {
  return (
    <input
      className="inp"
      aria-invalid={error ? true : undefined}
      aria-describedby={error && props.id ? `${props.id}-error` : undefined}
      {...props}
    />
  );
}

/** Importe con símbolo de pesos; acepta lo que el usuario escriba y se limpia al guardar. */
export function EntradaImporte({
  valor,
  alCambiar,
  grande,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  valor: string;
  alCambiar: (v: string) => void;
  grande?: boolean;
  error?: string | null;
}) {
  const { error, ...resto } = props as { error?: string | null };
  return (
    <div style={{ position: 'relative' }}>
      <span
        style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: 'var(--texto-2)', fontSize: grande ? 20 : 16 }}
      >
        $
      </span>
      <input
        className="inp num"
        inputMode="decimal"
        value={valor}
        onChange={(e) => alCambiar(e.target.value.replace(/[^\d.]/g, ''))}
        aria-invalid={error ? true : undefined}
        style={{ paddingLeft: 30, ...(grande ? { minHeight: 54, fontSize: 20, fontWeight: 700 } : {}) }}
        {...resto}
      />
    </div>
  );
}

/** Selector de cantidad con +/− (suman 1 unidad) y decimales según la unidad. */
export function Cantidad({
  id,
  valor,
  alCambiar,
  decimales,
  unidad,
  invalido,
  descrito,
}: {
  id: string;
  valor: string;
  alCambiar: (v: string) => void;
  decimales: boolean;
  unidad: string;
  invalido?: boolean;
  descrito?: string;
}) {
  const paso = (d: number) => {
    const n = D(valor || 0).plus(d);
    alCambiar(n.lt(0) ? '0' : n.toString());
  };
  return (
    <div className="qty" aria-invalid={invalido || undefined}>
      <button type="button" aria-label={`Quitar una ${unidad}`} onClick={() => paso(-1)}>
        <Minus className="ic" />
      </button>
      <input
        id={id}
        className="num"
        inputMode={decimales ? 'decimal' : 'numeric'}
        value={valor}
        aria-invalid={invalido || undefined}
        aria-describedby={descrito}
        onChange={(e) => alCambiar(e.target.value.replace(decimales ? /[^\d.]/g : /\D/g, ''))}
      />
      <button type="button" aria-label={`Agregar una ${unidad}`} onClick={() => paso(1)}>
        <Plus className="ic" />
      </button>
    </div>
  );
}

export function Segmentado<T extends string>({
  opciones,
  valor,
  alCambiar,
  etiqueta,
}: {
  opciones: Array<{ valor: T; texto: string; icono?: ReactNode; deshabilitado?: boolean }>;
  valor: T;
  alCambiar: (v: T) => void;
  etiqueta: string;
}) {
  return (
    <div className="seg" role="group" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={o.valor === valor}
          disabled={o.deshabilitado}
          onClick={() => alCambiar(o.valor)}
        >
          {o.icono}
          {o.texto}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({
  opciones,
  valor,
  alCambiar,
  etiqueta,
}: {
  opciones: Array<{ valor: T; texto: string; cuenta?: number; icono?: ReactNode }>;
  valor: T;
  alCambiar: (v: T) => void;
  etiqueta: string;
}) {
  return (
    <div className="chips" role="group" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button key={o.valor} type="button" className="chip" aria-pressed={o.valor === valor} onClick={() => alCambiar(o.valor)}>
          {o.icono}
          {o.texto}
          {o.cuenta != null && o.cuenta > 0 && <span className="cnt">{o.cuenta}</span>}
        </button>
      ))}
    </div>
  );
}

export function Buscador({
  valor,
  alCambiar,
  etiqueta,
  marcador,
}: {
  valor: string;
  alCambiar: (v: string) => void;
  etiqueta: string;
  marcador: string;
}) {
  const id = useId();
  return (
    <div className="search">
      <label className="sr" htmlFor={id}>
        {etiqueta}
      </label>
      <Search className="ic" />
      <input id={id} className="inp" type="search" placeholder={marcador} value={valor} onChange={(e) => alCambiar(e.target.value)} />
      {valor && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Limpiar búsqueda"
          onClick={() => alCambiar('')}
          style={{ position: 'absolute', right: 2, top: 2 }}
        >
          <X className="ic" />
        </button>
      )}
    </div>
  );
}

/** Coincidencia sin acentos ni mayúsculas. */
export function coincide(texto: string | null | undefined, busqueda: string): boolean {
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return n(texto ?? '').includes(n(busqueda.trim()));
}
