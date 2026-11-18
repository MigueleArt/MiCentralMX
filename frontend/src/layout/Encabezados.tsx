import { ArrowLeft, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { EstadoSync } from '../componentes/Sincronizacion';
import { useFormato } from '../hooks/useFormato';

/** Encabezado de pestaña principal: título, subtítulo, estado de sincronización y acciones. */
export function EncabezadoPagina({ titulo, subtitulo, acciones }: { titulo: ReactNode; subtitulo?: ReactNode; acciones?: ReactNode }) {
  const formato = useFormato();
  return (
    <header className="pag-enc">
      <div style={{ minWidth: 0 }}>
        <h1 className="t-title">{titulo}</h1>
        {subtitulo && (
          <p className="t-2 num" style={{ marginTop: 2 }}>
            {subtitulo}
          </p>
        )}
      </div>
      <div className="acciones" style={{ paddingTop: formato === 'pc' ? 0 : 2 }}>
        <EstadoSync largo={formato === 'pc'} />
        {formato !== 'telefono' && acciones}
      </div>
    </header>
  );
}

/**
 * Encabezado de pantalla secundaria (detalle o formulario) con regresar o cerrar.
 * `volverA` define el destino explícito; sin él, regresa en el historial.
 */
export function EncabezadoSecundario({
  titulo,
  subtitulo,
  volverA,
  cerrar,
  acciones,
  conSync = true,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  volverA?: string;
  cerrar?: boolean;
  acciones?: ReactNode;
  conSync?: boolean;
}) {
  const navegar = useNavigate();
  const volver = () => (volverA ? navegar(volverA) : navegar(-1));
  return (
    <header className="enc-sec">
      <button type="button" className="icon-btn" aria-label={cerrar ? 'Cerrar' : 'Regresar'} onClick={volver}>
        {cerrar ? <X className="ic" /> : <ArrowLeft className="ic" />}
      </button>
      <div className="titulo">
        <h1>{titulo}</h1>
        {subtitulo && <p className="num">{subtitulo}</p>}
      </div>
      {conSync && <EstadoSync />}
      {acciones}
    </header>
  );
}
