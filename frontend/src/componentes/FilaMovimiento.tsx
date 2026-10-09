import { ArrowDownLeft, ArrowUpRight, Clock, HandCoins, PackageMinus, Receipt, ShoppingCart } from 'lucide-react';
import { Link } from 'react-router';
import type { MovimientoReciente, TipoMovimiento } from '../dominio/resumenes';
import { formatoMXN, formatoMXNSigno } from '../lib/dinero';
import { formatoHora, formatoRelativo, diaLocal } from '../lib/fechas';

const ESTILO: Record<TipoMovimiento, { icono: typeof Receipt; fondo: string; color: string; etiqueta: string; colorEtiqueta: string }> = {
  venta: { icono: Receipt, fondo: 'var(--color-primario-suave)', color: 'var(--color-primario)', etiqueta: 'Ingreso', colorEtiqueta: 'var(--ok-texto)' },
  credito: { icono: Receipt, fondo: 'var(--color-primario-suave)', color: 'var(--color-primario)', etiqueta: 'A crédito', colorEtiqueta: 'var(--aviso-texto)' },
  compra: { icono: ShoppingCart, fondo: 'var(--info-fondo)', color: 'var(--info-texto)', etiqueta: 'Egreso', colorEtiqueta: 'var(--error-texto)' },
  pago: { icono: HandCoins, fondo: 'var(--ok-fondo)', color: 'var(--ok-texto)', etiqueta: 'Ingreso', colorEtiqueta: 'var(--ok-texto)' },
  merma: { icono: PackageMinus, fondo: 'var(--aviso-fondo)', color: 'var(--aviso-texto)', etiqueta: 'Inventario', colorEtiqueta: 'var(--texto-2)' },
  ingreso: { icono: ArrowDownLeft, fondo: 'var(--ok-fondo)', color: 'var(--ok-texto)', etiqueta: 'Ingreso', colorEtiqueta: 'var(--ok-texto)' },
  egreso: { icono: ArrowUpRight, fondo: 'var(--error-fondo)', color: 'var(--error-texto)', etiqueta: 'Egreso', colorEtiqueta: 'var(--error-texto)' },
};

export function FilaMovimiento({ m, conEtiqueta }: { m: MovimientoReciente; conEtiqueta?: boolean }) {
  const e = ESTILO[m.tipo];
  const cuando = diaLocal(m.fecha) === diaLocal() ? formatoHora(m.fecha) : formatoRelativo(m.fecha);
  const monto = m.monto == null ? m.textoMonto : m.tipo === 'credito' ? formatoMXN(m.monto) : formatoMXNSigno(m.monto);
  return (
    <Link className="rowlink" to={m.ruta}>
      <span className="cuadro-ic" style={{ background: e.fondo, color: e.color }}>
        <e.icono className="ic" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.titulo}</p>
        <p className="t-aux" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {cuando} · {m.detalle}
        </p>
      </div>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 84 }}>
        <p className="num" style={{ fontWeight: 700, fontSize: 15 }}>
          {monto}
        </p>
        {conEtiqueta && (
          <p style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: e.colorEtiqueta }}>
            {m.tipo === 'credito' && <Clock style={{ width: 12, height: 12 }} />}
            {e.etiqueta}
          </p>
        )}
      </div>
    </Link>
  );
}
