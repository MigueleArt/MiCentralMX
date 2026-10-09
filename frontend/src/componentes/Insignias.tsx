import { Ban, CircleAlert, CircleCheck, Clock, CloudUpload, TriangleAlert } from 'lucide-react';
import type { EstadoVenta } from '@micentralmx/shared/entidades';
import type { EstadoSync } from '../db/db';
import type { EstadoCliente, EstadoDeuda } from '../dominio/consultas';

export function InsigniaVenta({ estado }: { estado: EstadoVenta }) {
  switch (estado) {
    case 'completada':
      return (
        <span className="bdg b-ok">
          <CircleCheck className="ic" />
          Completada
        </span>
      );
    case 'por_confirmar':
      return (
        <span className="bdg b-info">
          <Clock className="ic" />
          Por confirmar
        </span>
      );
    case 'a_credito':
      return (
        <span className="bdg b-warn">
          <Clock className="ic" />
          Crédito pendiente
        </span>
      );
    case 'cancelada':
      return (
        <span className="bdg b-neu">
          <Ban className="ic" />
          Cancelada
        </span>
      );
  }
}

export function InsigniaDeuda({ estado }: { estado: EstadoDeuda }) {
  switch (estado) {
    case 'vencida':
      return (
        <span className="bdg b-err">
          <CircleAlert className="ic" />
          Vencida
        </span>
      );
    case 'proxima':
      return (
        <span className="bdg b-warn">
          <Clock className="ic" />
          Próxima
        </span>
      );
    case 'pendiente':
      return (
        <span className="bdg b-neu">
          <Clock className="ic" />
          Pendiente
        </span>
      );
    case 'pagada':
      return (
        <span className="bdg b-ok">
          <CircleCheck className="ic" />
          Pagada
        </span>
      );
  }
}

export function InsigniaCliente({ estado }: { estado: EstadoCliente }) {
  if (estado === 'vencida') return <InsigniaDeuda estado="vencida" />;
  if (estado === 'proxima') return <InsigniaDeuda estado="proxima" />;
  if (estado === 'al_corriente')
    return (
      <span className="bdg b-ok">
        <CircleCheck className="ic" />
        Al corriente
      </span>
    );
  return <span className="bdg b-neu">Sin saldo</span>;
}

/** "Sin sincronizar" (azul) o "En revisión" (ámbar) en cada tarjeta (decisiones técnicas §5). */
export function InsigniaSync({ estado }: { estado: EstadoSync | null }) {
  if (!estado || estado === 'sincronizada') return null;
  if (estado === 'en_revision')
    return (
      <span className="bdg b-acc">
        <TriangleAlert className="ic" />
        En revisión
      </span>
    );
  if (estado === 'rechazada')
    return (
      <span className="bdg b-errt">
        <CircleAlert className="ic" />
        Rechazada
      </span>
    );
  return (
    <span className="bdg b-info">
      <CloudUpload className="ic" />
      Sin sincronizar
    </span>
  );
}

export function InsigniaInventario({ bajo, sin }: { bajo: boolean; sin: boolean }) {
  if (sin)
    return (
      <span className="bdg b-errt bdg-sm">
        <CircleAlert className="ic" />
        Sin existencia
      </span>
    );
  if (bajo)
    return (
      <span className="bdg b-warn bdg-sm">
        <TriangleAlert className="ic" />
        Bajo
      </span>
    );
  return null;
}
