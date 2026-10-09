import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Pencil, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { api, mensajeError } from '../../api/cliente';
import { useSesionActiva } from '../../auth/SesionContext';
import { useAvisos } from '../../componentes/Avisos';
import { AvisoLinea, ErrorConsulta, Esqueleto } from '../../componentes/Estados';
import { Campo, Entrada } from '../../componentes/Formulario';
import { HojaInferior } from '../../componentes/Superpuestos';
import type { RolNegocio, UsuarioNegocio } from '@micentralmx/shared/api';
import { PERMISOS, type Permiso } from '@micentralmx/shared/permisos';
import { crearUsuario, editarRol, editarUsuario } from '../../dominio/enLinea';
import { useFormato } from '../../hooks/useFormato';
import { EncabezadoPagina, EncabezadoSecundario } from '../../layout/Encabezados';
import { haceCuanto } from '../../lib/fechas';
import { iniciales } from '../../lib/ids';
import { useConectividad } from '../../sync/conectividad';

function EditarRol({ rol, alCerrar }: { rol: RolNegocio; alCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [permisos, setPermisos] = useState<string[]>(rol.permisos);
  const m = useMutation({
    mutationFn: () => editarRol(rol.id, permisos),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['roles'] });
      avisar(`Permisos de ${rol.nombre} actualizados`);
      alCerrar();
    },
  });
  return (
    <HojaInferior titulo={`Qué puede hacer un ${rol.nombre}`} alCerrar={alCerrar}>
      <div className="card" style={{ overflow: 'hidden' }}>
        {(Object.keys(PERMISOS) as Permiso[]).map((p) => (
          <label key={p} className="rowlink" style={{ cursor: 'pointer' }}>
            <span style={{ flex: 1 }}>{PERMISOS[p]}</span>
            <input
              type="checkbox"
              checked={permisos.includes(p)}
              onChange={(e) => setPermisos(e.target.checked ? [...permisos, p] : permisos.filter((x) => x !== p))}
              style={{ width: 22, height: 22, accentColor: 'var(--color-primario)' }}
            />
          </label>
        ))}
      </div>
      {m.isError && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{mensajeError(m.error)}</AvisoLinea>}
      <button type="button" className="btn btn-p" disabled={m.isPending} onClick={() => m.mutate()}>
        Guardar permisos
      </button>
    </HojaInferior>
  );
}

function FormUsuario({ usuario, roles, alCerrar }: { usuario: UsuarioNegocio | null; roles: RolNegocio[]; alCerrar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const { sesion } = useSesionActiva();
  const [nombre, setNombre] = useState(usuario?.nombre ?? '');
  const [login, setLogin] = useState(usuario?.usuario ?? '');
  const [rolId, setRolId] = useState(usuario?.rolId ?? roles.find((r) => r.base === 'trabajador')?.id ?? '');
  const [contrasena, setContrasena] = useState('');
  const esDueno = roles.find((r) => r.id === usuario?.rolId)?.base === 'dueno';
  const m = useMutation({
    mutationFn: (extra: { activo?: boolean } = {}) =>
      usuario ? editarUsuario(usuario.id, { nombre, rolId, ...(contrasena ? { contrasena } : {}), ...extra }) : crearUsuario({ nombre, usuario: login, rolId, contrasena }),
    onSuccess: (_, extra) => {
      void qc.invalidateQueries({ queryKey: ['usuarios'] });
      avisar(extra?.activo === false ? 'Usuario suspendido' : extra?.activo ? 'Usuario reactivado' : usuario ? 'Usuario actualizado' : 'Usuario agregado');
      alCerrar();
    },
  });
  return (
    <HojaInferior titulo={usuario ? 'Editar usuario' : 'Agregar usuario'} alCerrar={alCerrar}>
      <Campo etiqueta="Nombre" id="u-nombre">
        <Entrada id="u-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </Campo>
      <Campo etiqueta="Usuario o teléfono" id="u-login">
        <Entrada id="u-login" value={login} onChange={(e) => setLogin(e.target.value)} readOnly={!!usuario} />
      </Campo>
      <Campo etiqueta="Rol" id="u-rol">
        <select id="u-rol" className="inp" value={rolId} onChange={(e) => setRolId(e.target.value)} disabled={esDueno}>
          {roles.map((r) => (
            <option key={r.id} value={r.id} disabled={r.base === 'dueno' && !esDueno}>
              {r.nombre}
            </option>
          ))}
        </select>
      </Campo>
      <Campo etiqueta={usuario ? 'Restablecer contraseña' : 'Contraseña'} id="u-pass" opcional={!!usuario} ayuda="Mínimo 8 caracteres.">
        <Entrada id="u-pass" type="password" autoComplete="new-password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} />
      </Campo>
      {m.isError && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{mensajeError(m.error)}</AvisoLinea>}
      <button type="button" className="btn btn-p" disabled={m.isPending} onClick={() => m.mutate({})}>
        {usuario ? 'Guardar cambios' : 'Agregar usuario'}
      </button>
      {usuario && !esDueno && usuario.id !== sesion.usuario.id && (
        <button type="button" className={`btn ${usuario.activo ? 'btn-g' : 'btn-s'}`} style={usuario.activo ? { color: 'var(--error-texto)' } : undefined} disabled={m.isPending} onClick={() => m.mutate({ activo: !usuario.activo })}>
          {usuario.activo ? 'Suspender usuario' : 'Reactivar usuario'}
        </button>
      )}
      {usuario?.activo && !esDueno && <p className="hint">Lo que registre sin conexión después de suspenderlo quedará en revisión.</p>}
    </HojaInferior>
  );
}

/** Pantalla 27 · Usuarios, roles y permisos (solo en línea). */
export default function Usuarios() {
  const formato = useFormato();
  const { enLinea } = useConectividad();
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => api<UsuarioNegocio[]>('GET', '/usuarios') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<RolNegocio[]>('GET', '/roles') });
  const [editando, setEditando] = useState<UsuarioNegocio | null | 'nuevo'>(null);
  const [rolEditado, setRolEditado] = useState<RolNegocio | null>(null);
  const trabajador = roles.data?.find((r) => r.base === 'trabajador');
  const rolDe = (u: UsuarioNegocio) => roles.data?.find((r) => r.id === u.rolId);

  const cuerpo = () => {
    if (usuarios.isPending || roles.isPending) return <Esqueleto filas={3} texto="Cargando usuarios…" />;
    if (usuarios.isError || roles.isError)
      return <ErrorConsulta error={usuarios.error ?? roles.error} enLinea={enLinea} reintentar={() => { void usuarios.refetch(); void roles.refetch(); }} />;
    return (
      <>
        <div className="card" style={{ overflow: 'hidden' }}>
          {usuarios.data.map((u) => (
            <button key={u.id} type="button" className="rowlink" onClick={() => setEditando(u)}>
              <span className="avatar">{iniciales(u.nombre)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 600 }}>{u.nombre}</p>
                <p className="t-aux">{!u.activo ? 'Suspendido' : u.ultimaActividad ? `Activo ${haceCuanto(u.ultimaActividad)}` : 'Sin actividad'}</p>
              </div>
              <span className={`bdg ${rolDe(u)?.base === 'dueno' ? 'b-acc' : rolDe(u)?.base === 'administrador' ? 'b-info' : 'b-neu'}`}>{u.rolNombre}</span>
            </button>
          ))}
        </div>
        {trabajador && (
          <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="fila-entre">
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Qué puede hacer un Trabajador</h2>
              <button type="button" className="enlace" onClick={() => setRolEditado(trabajador)}>
                <Pencil className="ic" style={{ width: 16, height: 16 }} />
                Editar
              </button>
            </div>
            <ul className="pila" style={{ gap: 6 }}>
              {(Object.keys(PERMISOS) as Permiso[])
                .sort((a, b) => Number(trabajador.permisos.includes(b)) - Number(trabajador.permisos.includes(a)))
                .slice(0, 8)
                .map((p) => {
                  const si = trabajador.permisos.includes(p);
                  return (
                    <li key={p} className="fila t-2" style={{ color: si ? 'var(--texto)' : 'var(--texto-2)' }}>
                      {si ? <Check className="ic" style={{ color: 'var(--ok-texto)', width: 18 }} /> : <X className="ic" style={{ width: 18 }} />}
                      {si ? PERMISOS[p] : `No permitido: ${PERMISOS[p].charAt(0).toLowerCase()}${PERMISOS[p].slice(1)}`}
                    </li>
                  );
                })}
            </ul>
          </section>
        )}
      </>
    );
  };

  const agregar = (
    <button type="button" className="btn btn-p" disabled={!roles.data} onClick={() => setEditando('nuevo')}>
      <UserPlus className="ic" />
      Agregar usuario
    </button>
  );
  return (
    <>
      {formato === 'telefono' ? <EncabezadoSecundario titulo="Usuarios" volverA="/mas" /> : <EncabezadoPagina titulo="Usuarios" subtitulo="Roles y permisos" acciones={agregar} />}
      <main className={`pag-main${formato === 'telefono' ? ' con-enc-sec con-barra' : ''}`}>
        <div className="pila-16" style={{ maxWidth: 720 }}>{cuerpo()}</div>
      </main>
      {formato === 'telefono' && <div className="barra-accion">{agregar}</div>}
      {editando && roles.data && <FormUsuario usuario={editando === 'nuevo' ? null : editando} roles={roles.data} alCerrar={() => setEditando(null)} />}
      {rolEditado && <EditarRol rol={rolEditado} alCerrar={() => setRolEditado(null)} />}
    </>
  );
}
