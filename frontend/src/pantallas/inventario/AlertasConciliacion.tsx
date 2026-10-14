import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { Link } from 'react-router';
import type { AlertaInventario } from '@micentralmx/shared/api';
import { api, mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { AvisoLinea } from '../../componentes/Estados';
import { D, formatoCantidad } from '../../lib/dinero';
import { useConectividad } from '../../sync/conectividad';
import { sincronizar } from '../../sync/motor';

export const claveAlertas = ['inventario', 'alertas'] as const;

/** Alertas de la conciliación nocturna (solo en línea y con permiso de ajustar inventario). */
export function useAlertasInventario() {
  const { puede } = useSesionActiva();
  const { enLinea } = useConectividad();
  return useQuery({
    queryKey: claveAlertas,
    queryFn: () => api<AlertaInventario[]>('GET', '/inventario/alertas'),
    enabled: enLinea && puede('inventario.ajustar'),
    refetchInterval: 5 * 60_000,
  });
}

/**
 * Aviso en Inventario: la existencia guardada no coincide con la suma de su historial.
 * El historial es la fuente de verdad (decisiones técnicas §4.4); corregir iguala la existencia.
 */
export function AlertasConciliacion() {
  const alertas = useAlertasInventario();
  const qc = useQueryClient();
  const avisar = useAvisos();
  const corregir = useMutation({
    mutationFn: (id: string) => api<{ existencia: string }>('POST', `/inventario/alertas/${id}/corregir`, {}),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: claveAlertas });
      avisar('Existencia igualada a su historial');
      void sincronizar();
    },
  });
  const lista = alertas.data ?? [];
  if (lista.length === 0) return null;
  return (
    <AvisoLinea tono="warn" icono={<Scale className="ic" />}>
      <strong>
        {lista.length === 1 ? 'Una existencia no coincide con su historial' : `${lista.length} existencias no coinciden con su historial`}
      </strong>
      La revisión nocturna encontró diferencias entre la existencia guardada y la suma de sus movimientos. Corregir la iguala al historial; si el
      conteo físico es otro, después registra un{' '}
      <Link to="/inventario/mermas">ajuste</Link>.
      <span className="pila" style={{ marginTop: 10, gap: 8 }}>
        {lista.map((a) => {
          const dif = D(a.existencia).minus(a.sumaMovimientos);
          return (
            <span key={a.id} className="fila-entre" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span style={{ color: 'var(--texto)' }}>
                <Link to={`/inventario/${a.productoId}`} style={{ fontWeight: 600 }}>
                  {a.descripcion}
                </Link>
                <span className="num" style={{ display: 'block', fontSize: 13 }}>
                  Guardada {formatoCantidad(a.existencia)} · historial {formatoCantidad(a.sumaMovimientos)} {a.unidadPlural} ({dif.isPositive() ? '+' : '−'}
                  {formatoCantidad(dif.abs())})
                </span>
              </span>
              <button type="button" className="btn btn-s btn-sm" disabled={corregir.isPending} onClick={() => corregir.mutate(a.id)}>
                Corregir con el historial
              </button>
            </span>
          );
        })}
      </span>
      {corregir.isError && <span className="err-msg" style={{ marginTop: 6 }}>{mensajeError(corregir.error)}</span>}
    </AvisoLinea>
  );
}
