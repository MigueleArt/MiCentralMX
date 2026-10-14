import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, CircleAlert, KeyRound, LogOut, RefreshCw, Smartphone, Store, UserCog } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, mensajeError } from '../../api/cliente';
import { cerrarSesion } from '../../auth/sesion';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { AvisoLinea } from '../../componentes/Estados';
import { Campo, Entrada } from '../../componentes/Formulario';
import { EstadoSync } from '../../componentes/Sincronizacion';
import { HojaInferior } from '../../componentes/Superpuestos';
import type { ConfiguracionNegocio, Negocio } from '@micentralmx/shared/entidades';
import { cambiarContrasena, guardarConfiguracion } from '../../dominio/enLinea';
import { useFormato } from '../../hooks/useFormato';
import { useResumenSync } from '../../hooks/useResumenSync';
import { EncabezadoPagina, EncabezadoSecundario } from '../../layout/Encabezados';
import { formatoRelativo } from '../../lib/fechas';
import { iniciales } from '../../lib/ids';
import { sincronizar, useEstadoMotor } from '../../sync/motor';

function DatosNegocio({ alCerrar }: { alCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const q = useQuery({ queryKey: ['configuracion'], queryFn: () => api<Negocio & ConfiguracionNegocio>('GET', '/configuracion') });
  const [v, setV] = useState<{ nombre: string; ubicacion: string; horas: string; plazo: string } | null>(null);
  if (q.data && !v) setV({ nombre: q.data.nombre, ubicacion: q.data.ubicacion ?? '', horas: String(q.data.ventanaOfflineHoras), plazo: String(q.data.plazoCreditoDias) });
  const m = useMutation({
    mutationFn: () => guardarConfiguracion({ nombre: v!.nombre, ubicacion: v!.ubicacion || null, ventanaOfflineHoras: Number(v!.horas), plazoCreditoDias: Number(v!.plazo) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['configuracion'] });
      avisar('Configuración guardada');
      alCerrar();
    },
  });
  return (
    <HojaInferior titulo="Datos del negocio" alCerrar={alCerrar}>
      {q.isError && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{mensajeError(q.error)}</AvisoLinea>}
      {v && (
        <>
          <Campo etiqueta="Nombre del negocio" id="n-nombre">
            <Entrada id="n-nombre" value={v.nombre} onChange={(e) => setV({ ...v, nombre: e.target.value })} />
          </Campo>
          <Campo etiqueta="Ubicación" id="n-ubic" opcional>
            <Entrada id="n-ubic" value={v.ubicacion} onChange={(e) => setV({ ...v, ubicacion: e.target.value })} />
          </Campo>
          <Campo etiqueta="Horas sin conexión permitidas" id="n-horas" ayuda="Después de este tiempo sin contacto con el servidor, la app queda en solo lectura.">
            <Entrada id="n-horas" inputMode="numeric" value={v.horas} onChange={(e) => setV({ ...v, horas: e.target.value.replace(/\D/g, '') })} />
          </Campo>
          <Campo etiqueta="Plazo de crédito predeterminado (días)" id="n-plazo">
            <Entrada id="n-plazo" inputMode="numeric" value={v.plazo} onChange={(e) => setV({ ...v, plazo: e.target.value.replace(/\D/g, '') })} />
          </Campo>
          {m.isError && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{mensajeError(m.error)}</AvisoLinea>}
          <button type="button" className="btn btn-p" disabled={m.isPending} onClick={() => m.mutate()}>
            Guardar
          </button>
        </>
      )}
    </HojaInferior>
  );
}

function CambiarContrasena({ alCerrar }: { alCerrar: () => void }) {
  const avisar = useAvisos();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const m = useMutation({
    mutationFn: () => cambiarContrasena(actual, nueva),
    onSuccess: () => {
      avisar('Contraseña actualizada');
      alCerrar();
    },
  });
  return (
    <HojaInferior titulo="Cambiar contraseña" alCerrar={alCerrar}>
      <Campo etiqueta="Contraseña actual" id="c-actual">
        <Entrada id="c-actual" type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} />
      </Campo>
      <Campo etiqueta="Nueva contraseña" id="c-nueva" ayuda="Mínimo 8 caracteres.">
        <Entrada id="c-nueva" type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
      </Campo>
      {m.isError && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{mensajeError(m.error)}</AvisoLinea>}
      <button type="button" className="btn btn-p" disabled={m.isPending || !actual || nueva.length < 8} onClick={() => m.mutate()}>
        Cambiar contraseña
      </button>
    </HojaInferior>
  );
}

/** Pantalla 29 · Configuración: negocio, sincronización y cuenta. */
export default function Configuracion() {
  const { sesion, dispositivo, puede } = useSesionActiva();
  const formato = useFormato();
  const navegar = useNavigate();
  const r = useResumenSync();
  const motor = useEstadoMotor();
  const [hoja, setHoja] = useState<'negocio' | 'contrasena' | null>(null);
  const [errorSalida, setErrorSalida] = useState<string | null>(null);

  const salir = async () => {
    setErrorSalida(null);
    try {
      await cerrarSesion();
      navegar('/login', { replace: true });
    } catch (e) {
      setErrorSalida(mensajeError(e));
    }
  };

  return (
    <>
      {formato === 'telefono' ? <EncabezadoSecundario titulo="Configuración" volverA="/mas" /> : <EncabezadoPagina titulo="Configuración" />}
      <main className={`pag-main${formato === 'telefono' ? ' con-enc-sec' : ''}`}>
        <div className="pila-16" style={{ maxWidth: 640 }}>
          <section className="pila">
            <h2 className="lbl">Negocio</h2>
            <div className="card" style={{ overflow: 'hidden' }}>
              {puede('configuracion.editar') ? (
                <button type="button" className="rowlink" onClick={() => setHoja('negocio')}>
                  <span className="ib"><Store className="ic" /></span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 600 }}>Datos del negocio</p>
                    <p className="t-aux">{sesion.negocio.nombre}{sesion.negocio.ubicacion ? ` · ${sesion.negocio.ubicacion}` : ''}</p>
                  </div>
                  <ChevronRight className="ic" />
                </button>
              ) : (
                <div className="rowlink" style={{ cursor: 'default' }}>
                  <span className="ib"><Store className="ic" /></span>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 600 }}>{sesion.negocio.nombre}</p>
                    <p className="t-aux">{sesion.negocio.ubicacion}</p>
                  </div>
                </div>
              )}
              {puede('usuarios.gestionar') && (
                <Link className="rowlink" to="/usuarios">
                  <span className="ib"><UserCog className="ic" /></span>
                  <p style={{ flex: 1, fontWeight: 600 }}>Usuarios y permisos</p>
                  <ChevronRight className="ic" />
                </Link>
              )}
            </div>
          </section>

          <section className="pila">
            <h2 className="lbl">Sincronización</h2>
            <dl className="card" style={{ padding: '4px 16px' }}>
              <div className="kv">
                <dt>Estado</dt>
                <dd><EstadoSync /></dd>
              </div>
              <div className="kv">
                <dt>Última sincronización</dt>
                <dd className="num">{r.ultimoPull ? formatoRelativo(r.ultimoPull) : 'Nunca'}</dd>
              </div>
              <div className="kv">
                <dt>Este dispositivo</dt>
                <dd className="fila" style={{ gap: 6 }}>
                  <Smartphone className="ic" style={{ width: 16, height: 16 }} />
                  {dispositivo?.codigo ?? '—'}
                </dd>
              </div>
            </dl>
            <button type="button" className="btn btn-q" disabled={!r.enLinea || motor.sincronizando} onClick={() => void sincronizar()}>
              <RefreshCw className={`ic${motor.sincronizando ? ' girar' : ''}`} />
              Sincronizar ahora
            </button>
          </section>

          <section className="pila">
            <h2 className="lbl">Mi cuenta</h2>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="rowlink" style={{ cursor: 'default' }}>
                <span className="avatar">{iniciales(sesion.usuario.nombre)}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 600 }}>{sesion.usuario.nombre}</p>
                  <p className="t-aux">{sesion.usuario.rolNombre}</p>
                </div>
              </div>
              <button type="button" className="rowlink" onClick={() => setHoja('contrasena')} disabled={!r.enLinea}>
                <span className="ib"><KeyRound className="ic" /></span>
                <p style={{ flex: 1, fontWeight: 600 }}>Cambiar contraseña</p>
                <ChevronRight className="ic" />
              </button>
            </div>
          </section>

          {errorSalida && <AvisoLinea tono="warn" icono={<CircleAlert className="ic" />}>{errorSalida}</AvisoLinea>}
          <button type="button" className="btn btn-g" style={{ color: 'var(--error-texto)' }} onClick={() => void salir()}>
            <LogOut className="ic" />
            Cerrar sesión
          </button>
        </div>
      </main>
      {hoja === 'negocio' && <DatosNegocio alCerrar={() => setHoja(null)} />}
      {hoja === 'contrasena' && <CambiarContrasena alCerrar={() => setHoja(null)} />}
    </>
  );
}
