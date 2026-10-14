import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CircleAlert, CircleCheck, ClipboardCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, mensajeError } from '../../api/cliente';
import { db } from '../../db/db';
import { ahoraIso } from '../../lib/fechas';
import { useAvisos } from '../../componentes/Avisos';
import { AvisoLinea, ErrorConsulta, EstadoVacio, Esqueleto } from '../../componentes/Estados';
import { Segmentado } from '../../componentes/Formulario';
import { Dialogo } from '../../componentes/Superpuestos';
import type { AccionRevision, OperacionEnRevision } from '@micentralmx/shared/api';
import { useFormato } from '../../hooks/useFormato';
import { EncabezadoPagina, EncabezadoSecundario } from '../../layout/Encabezados';
import { formatoFechaHora, formatoRelativo } from '../../lib/fechas';
import { useConectividad } from '../../sync/conectividad';
import { sincronizar } from '../../sync/motor';

type Vista = 'pendientes' | 'resueltas';

export const claveRevisiones = ['revisiones'] as const;

/** Enlace al registro afectado, si existe en la app. */
function rutaDe(r: OperacionEnRevision): string | null {
  if (!r.aplicada) return null;
  switch (r.tipo) {
    case 'venta.crear':
      return r.entidadId ? `/ventas/${r.entidadId}` : null;
    case 'pago.crear':
    case 'cliente.crear':
      return r.clienteId ? `/clientes/${r.clienteId}` : null;
    case 'compra.crear':
      return '/compras';
    case 'merma.crear':
      return '/inventario/mermas';
    case 'movimiento_dinero.crear':
      return '/pagos';
  }
}

function Estado({ r }: { r: OperacionEnRevision }) {
  if (r.resolucion) {
    const texto = { aprobada: 'Aprobada', reaplicada: 'Reaplicada', descartada: 'Descartada' }[r.resolucion];
    return (
      <span className={`bdg ${r.resolucion === 'descartada' ? 'b-neu' : 'b-ok'}`}>
        {r.resolucion === 'descartada' ? <Ban className="ic" /> : <CircleCheck className="ic" />}
        {texto}
      </span>
    );
  }
  if (r.estado === 'rechazada')
    return (
      <span className="bdg b-errt">
        <CircleAlert className="ic" />
        Rechazada
      </span>
    );
  return r.aplicada ? (
    <span className="bdg b-acc">
      <TriangleAlert className="ic" />
      Registrada · por aprobar
    </span>
  ) : (
    <span className="bdg b-warn">
      <TriangleAlert className="ic" />
      Sin aplicar
    </span>
  );
}

const TEXTO_ACCION: Record<AccionRevision, { titulo: string; boton: string; explicacion: string }> = {
  aprobar: {
    titulo: 'Aprobar operación',
    boton: 'Aprobar',
    explicacion: 'La operación ya está registrada. Al aprobarla se quita la marca de revisión. Si hay que corregir algo, hazlo con una cancelación o un ajuste.',
  },
  reaplicar: {
    titulo: 'Reaplicar operación',
    boton: 'Reaplicar',
    explicacion: 'Se vuelve a intentar con los datos actuales del servidor, por ejemplo cuando ya llegó el cliente o la venta de la que dependía.',
  },
  descartar: {
    titulo: 'Descartar operación',
    boton: 'Descartar',
    explicacion: 'La operación no se registrará. Queda en el historial como descartada.',
  },
};

/**
 * Revisiones: operaciones sincronizadas que quedaron en revisión o fueron rechazadas
 * (propuesta §7.1 paso 5). Solo en línea y con el permiso revisiones.resolver.
 */
export default function Revisiones() {
  const formato = useFormato();
  const { enLinea } = useConectividad();
  const avisar = useAvisos();
  const qc = useQueryClient();
  const [vista, setVista] = useState<Vista>('pendientes');
  const [accion, setAccion] = useState<{ r: OperacionEnRevision; accion: AccionRevision } | null>(null);
  const [nota, setNota] = useState('');

  const consulta = useQuery({
    queryKey: [...claveRevisiones, vista],
    queryFn: () => api<OperacionEnRevision[]>('GET', `/revisiones${vista === 'resueltas' ? '?estado=resueltas' : ''}`),
  });
  const resolver = useMutation({
    mutationFn: (p: { id: string; accion: AccionRevision; nota: string }) =>
      api<OperacionEnRevision>('POST', `/revisiones/${p.id}/resolver`, { accion: p.accion, nota: p.nota || undefined }),
    onSuccess: async (r, p) => {
      setAccion(null);
      setNota('');
      // Si la operación salió de este dispositivo, deja de contarse en su insignia local.
      await db.operaciones.update(p.id, { enteradoEn: ahoraIso() });
      await qc.invalidateQueries({ queryKey: claveRevisiones });
      avisar(r?.resolucion ? `${TEXTO_ACCION[p.accion].boton}: ${r.resumen}` : 'Se reaplicó, pero sigue con una observación por aprobar.');
      // La bajada trae los registros sin la marca de revisión o los recién aplicados.
      void sincronizar();
    },
  });

  const lista = consulta.data ?? [];
  return (
    <>
      {formato === 'telefono' ? <EncabezadoSecundario titulo="Revisiones" volverA="/mas" /> : <EncabezadoPagina titulo="Revisiones" subtitulo="Operaciones que llegaron con observaciones" />}
      <main className={`pag-main${formato === 'telefono' ? ' con-enc-sec' : ''}`}>
        <div className="pila-16" style={{ maxWidth: 820 }}>
          <Segmentado<Vista>
            etiqueta="Ver"
            valor={vista}
            alCambiar={setVista}
            opciones={[
              { valor: 'pendientes', texto: 'Pendientes' },
              { valor: 'resueltas', texto: 'Resueltas' },
            ]}
          />
          {consulta.isPending ? (
            <Esqueleto texto="Cargando revisiones…" />
          ) : consulta.isError ? (
            <ErrorConsulta error={consulta.error} enLinea={enLinea} reintentar={() => void consulta.refetch()} />
          ) : lista.length === 0 ? (
            <EstadoVacio
              icono={ClipboardCheck}
              titulo={vista === 'pendientes' ? 'Nada por revisar' : 'Sin revisiones resueltas'}
              texto={vista === 'pendientes' ? 'Las operaciones sin conexión con observaciones aparecerán aquí.' : 'Lo que se apruebe, reaplique o descarte aparecerá aquí.'}
            />
          ) : (
            <section className="pila" aria-label="Operaciones">
              {lista.map((r) => {
                const ruta = rutaDe(r);
                return (
                  <article key={r.operacionId} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="fila-entre" style={{ alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 16, fontWeight: 600 }}>{ruta ? <Link to={ruta}>{r.resumen}</Link> : r.resumen}</p>
                        <p className="t-aux num">
                          {r.usuarioNombre ?? 'Usuario desconocido'}
                          {r.dispositivoCodigo ? ` · ${r.dispositivoCodigo}` : ''} · registrada {formatoRelativo(r.creadoEnDispositivo)}
                        </p>
                      </div>
                      <Estado r={r} />
                    </div>
                    {r.motivo && (
                      <AvisoLinea tono={r.estado === 'rechazada' ? 'err' : 'warn'} icono={<TriangleAlert className="ic" />}>
                        {r.motivo}
                      </AvisoLinea>
                    )}
                    {r.resolucion ? (
                      <p className="t-2">
                        {r.resueltaPorNombre} · {r.resueltaEn && formatoFechaHora(r.resueltaEn)}
                        {r.notaResolucion && ` · “${r.notaResolucion}”`}
                      </p>
                    ) : (
                      <div className="fila" style={{ flexWrap: 'wrap' }}>
                        {r.aplicada && (
                          <button type="button" className="btn btn-p btn-sm" disabled={!enLinea} onClick={() => setAccion({ r, accion: 'aprobar' })}>
                            <CircleCheck className="ic" />
                            Aprobar
                          </button>
                        )}
                        {!r.aplicada && r.estado === 'en_revision' && (
                          <button type="button" className="btn btn-s btn-sm" disabled={!enLinea} onClick={() => setAccion({ r, accion: 'reaplicar' })}>
                            <RefreshCw className="ic" />
                            Reaplicar
                          </button>
                        )}
                        {!r.aplicada && (
                          <button type="button" className="btn btn-g btn-sm" style={{ color: 'var(--error-texto)' }} disabled={!enLinea} onClick={() => setAccion({ r, accion: 'descartar' })}>
                            <Ban className="ic" />
                            Descartar
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          )}
        </div>
      </main>

      {accion && (
        <Dialogo
          titulo={TEXTO_ACCION[accion.accion].titulo}
          tono={accion.accion === 'descartar' ? 'peligro' : 'neutro'}
          icono={accion.accion === 'descartar' ? <Ban className="ic" /> : accion.accion === 'reaplicar' ? <RefreshCw className="ic" /> : <CircleCheck className="ic" />}
          alCerrar={() => {
            setAccion(null);
            resolver.reset();
          }}
          acciones={
            <>
              <button
                type="button"
                className={`btn ${accion.accion === 'descartar' ? 'btn-d' : 'btn-p'}`}
                disabled={resolver.isPending}
                onClick={() => resolver.mutate({ id: accion.r.operacionId, accion: accion.accion, nota })}
              >
                {TEXTO_ACCION[accion.accion].boton}
              </button>
              <button type="button" className="btn btn-q" onClick={() => setAccion(null)}>
                Volver
              </button>
            </>
          }
        >
          <p style={{ fontWeight: 600 }}>{accion.r.resumen}</p>
          <p className="t-2" style={{ fontSize: 15 }}>
            {TEXTO_ACCION[accion.accion].explicacion}
          </p>
          <label className="flabel" htmlFor="nota-revision" style={{ marginTop: 8 }}>
            Nota <span className="t-aux" style={{ fontWeight: 500 }}>(opcional)</span>
          </label>
          <input id="nota-revision" className="inp" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. Se verificó con el trabajador" />
          {resolver.isError && <p className="err-msg">{mensajeError(resolver.error)}</p>}
        </Dialogo>
      )}
    </>
  );
}
