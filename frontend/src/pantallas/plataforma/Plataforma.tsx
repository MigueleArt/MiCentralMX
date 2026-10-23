import {
  Building2,
  Users,
  TrendingUp,
  Search,
  Plus,
  MapPin,
  Phone,
  Calendar,
  UserCheck,
  UserX,
  KeyRound,
  Edit2,
  LogOut,
  ExternalLink,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import type { NegocioPlataforma, UsuarioPlataforma } from '@micentralmx/shared/api';
import {
  obtenerTokenPlataforma,
  limpiarTokenPlataforma,
  obtenerNegociosPlataforma,
  crearNegocioPlataforma,
  actualizarNegocioPlataforma,
  obtenerUsuariosNegocioPlataforma,
  crearUsuarioNegocioPlataforma,
  cambiarEstadoUsuarioPlataforma,
  resetearClaveUsuarioPlataforma,
} from '../../api/plataforma';
import './plataforma.css';

export default function Plataforma() {
  const navigate = useNavigate();

  // Estados de datos
  const [negocios, setNegocios] = useState<NegocioPlataforma[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  // Filtros
  const [busqueda, setBusqueda] = useState('');

  // Modales
  const [modalNuevoNegocio, setModalNuevoNegocio] = useState(false);
  const [negocioParaEditar, setNegocioParaEditar] = useState<NegocioPlataforma | null>(null);
  const [negocioUsuarios, setNegocioUsuarios] = useState<NegocioPlataforma | null>(null);
  const [usuariosLocal, setUsuariosLocal] = useState<UsuarioPlataforma[]>([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(false);

  // Submodales de usuarios
  const [modalNuevoUsuario, setModalNuevoUsuario] = useState(false);
  const [usuarioParaResetClave, setUsuarioParaResetClave] = useState<UsuarioPlataforma | null>(null);
  const [nuevaClave, setNuevaClave] = useState('');

  // Formulario nuevo negocio
  const [formNegocio, setFormNegocio] = useState({
    nombre: '',
    ubicacion: '',
    telefono: '',
    duenoNombre: '',
    duenoUsuario: '',
    duenoClave: '',
  });

  // Formulario nuevo usuario
  const [formUsuario, setFormUsuario] = useState({
    nombre: '',
    usuario: '',
    contrasena: '',
    rolBase: 'trabajador' as 'administrador' | 'trabajador' | 'dueno',
  });

  // Formulario editar negocio
  const [formEditar, setFormEditar] = useState({
    nombre: '',
    ubicacion: '',
    telefono: '',
    ventanaOfflineHoras: 24,
    plazoCreditoDias: 7,
  });

  const [guardando, setGuardando] = useState(false);

  // Verificar token al montar
  useEffect(() => {
    const token = obtenerTokenPlataforma();
    if (!token) {
      navigate('/plataforma/login');
      return;
    }
    cargarDatos();
  }, [navigate]);

  const cargarDatos = async () => {
    setCargando(true);
    setError(null);
    try {
      const data = await obtenerNegociosPlataforma();
      setNegocios(data);
    } catch (err) {
      setError((err as Error).message || 'Error al cargar los locales.');
    } finally {
      setCargando(false);
    }
  };

  const handleCerrarSesion = () => {
    limpiarTokenPlataforma();
    navigate('/plataforma/login');
  };

  // Abrir gestión de usuarios de un local
  const handleAbrirUsuarios = async (n: NegocioPlataforma) => {
    setNegocioUsuarios(n);
    setCargandoUsuarios(true);
    try {
      const u = await obtenerUsuariosNegocioPlataforma(n.id);
      setUsuariosLocal(u);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargandoUsuarios(false);
    }
  };

  // Guardar nuevo local
  const handleCrearNegocio = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await crearNegocioPlataforma({
        nombre: formNegocio.nombre.trim(),
        ubicacion: formNegocio.ubicacion.trim() || null,
        telefono: formNegocio.telefono.trim() || null,
        dueno: {
          nombre: formNegocio.duenoNombre.trim(),
          usuario: formNegocio.duenoUsuario.trim().toLowerCase(),
          contrasena: formNegocio.duenoClave,
        },
      });
      setModalNuevoNegocio(false);
      setFormNegocio({
        nombre: '',
        ubicacion: '',
        telefono: '',
        duenoNombre: '',
        duenoUsuario: '',
        duenoClave: '',
      });
      setMensajeExito('¡Nuevo local registrado exitosamente!');
      await cargarDatos();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  // Abrir editar negocio
  const handleAbrirEditar = (n: NegocioPlataforma) => {
    setNegocioParaEditar(n);
    setFormEditar({
      nombre: n.nombre,
      ubicacion: n.ubicacion || '',
      telefono: n.telefono || '',
      ventanaOfflineHoras: n.ventanaOfflineHoras || 24,
      plazoCreditoDias: n.plazoCreditoDias || 7,
    });
  };

  // Guardar edición negocio
  const handleGuardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!negocioParaEditar) return;
    setGuardando(true);
    setError(null);
    try {
      await actualizarNegocioPlataforma(negocioParaEditar.id, {
        nombre: formEditar.nombre.trim(),
        ubicacion: formEditar.ubicacion.trim() || null,
        telefono: formEditar.telefono.trim() || null,
        ventanaOfflineHoras: Number(formEditar.ventanaOfflineHoras),
        plazoCreditoDias: Number(formEditar.plazoCreditoDias),
      });
      setNegocioParaEditar(null);
      setMensajeExito('Local actualizado correctamente.');
      await cargarDatos();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  // Cambiar estado de usuario (Activo / Suspendido)
  const handleToggleEstadoUsuario = async (u: UsuarioPlataforma) => {
    try {
      await cambiarEstadoUsuarioPlataforma(u.id, !u.activo);
      setUsuariosLocal((prev) =>
        prev.map((item) => (item.id === u.id ? { ...item, activo: !u.activo } : item)),
      );
      setMensajeExito(`Usuario ${u.usuario} ${!u.activo ? 'reactivado' : 'suspendido'}.`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Guardar nuevo usuario en el local
  const handleCrearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!negocioUsuarios) return;
    setGuardando(true);
    setError(null);
    try {
      await crearUsuarioNegocioPlataforma(negocioUsuarios.id, {
        nombre: formUsuario.nombre.trim(),
        usuario: formUsuario.usuario.trim().toLowerCase(),
        contrasena: formUsuario.contrasena,
        rolBase: formUsuario.rolBase,
      });
      setModalNuevoUsuario(false);
      setFormUsuario({ nombre: '', usuario: '', contrasena: '', rolBase: 'trabajador' });
      // Refrescar lista de usuarios del local
      const u = await obtenerUsuariosNegocioPlataforma(negocioUsuarios.id);
      setUsuariosLocal(u);
      setMensajeExito('Usuario agregado exitosamente.');
      await cargarDatos();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  // Resetear clave de usuario
  const handleResetClave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuarioParaResetClave || !nuevaClave.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await resetearClaveUsuarioPlataforma(usuarioParaResetClave.id, nuevaClave.trim());
      setUsuarioParaResetClave(null);
      setNuevaClave('');
      setMensajeExito(`Contraseña de ${usuarioParaResetClave.usuario} actualizada.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  // Totales calculados
  const metricas = useMemo(() => {
    const totalNegocios = negocios.length;
    const totalUsuarios = negocios.reduce((acc, n) => acc + (n.totalUsuarios || 0), 0);
    const totalVentas = negocios.reduce((acc, n) => acc + (n.totalVentas || 0), 0);
    return { totalNegocios, totalUsuarios, totalVentas };
  }, [negocios]);

  // Filtrado de negocios
  const negociosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return negocios;
    const q = busqueda.toLowerCase().trim();
    return negocios.filter(
      (n) =>
        n.nombre.toLowerCase().includes(q) ||
        (n.ubicacion && n.ubicacion.toLowerCase().includes(q)) ||
        (n.dueno && n.dueno.nombre.toLowerCase().includes(q)) ||
        (n.dueno && n.dueno.usuario.toLowerCase().includes(q)),
    );
  }, [negocios, busqueda]);

  return (
    <div className="plataforma-layout">
      {/* Barra Superior */}
      <header className="plataforma-nav">
        <div className="plataforma-marca">
          <div className="plataforma-logo-badge">
            <Building2 size={18} />
            <span>SUPERADMIN</span>
          </div>
          <div>
            <h1 className="plataforma-titulo-nav">MiCentralMX Plataforma</h1>
            <span className="plataforma-subtitulo-nav">Gestión Multi-Cuentas & Locales</span>
          </div>
        </div>

        <div className="plataforma-nav-acciones">
          <Link
            to="/"
            target="_blank"
            className="btn btn-q"
            style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <span>Ir a la App de Bodega</span>
            <ExternalLink size={14} />
          </Link>

          <button
            onClick={handleCerrarSesion}
            className="btn btn-q"
            title="Cerrar sesión de SuperAdmin"
            style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <LogOut size={15} />
            <span>Salir</span>
          </button>
        </div>
      </header>

      {/* Contenedor Principal */}
      <main className="plataforma-contenedor">
        {/* Notificaciones */}
        {error && (
          <div
            style={{
              padding: '0.85rem 1rem',
              background: 'var(--error-fondo)',
              color: 'var(--error-texto)',
              borderRadius: 'var(--radio-s)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontWeight: 500,
              fontSize: '0.9rem',
              border: '1px solid rgba(197, 60, 60, 0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {mensajeExito && (
          <div
            style={{
              padding: '0.85rem 1rem',
              background: 'var(--ok-fondo)',
              color: 'var(--ok-texto)',
              borderRadius: 'var(--radio-s)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontWeight: 500,
              fontSize: '0.9rem',
              border: '1px solid rgba(31, 94, 67, 0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={18} />
              <span>{mensajeExito}</span>
            </div>
            <button
              onClick={() => setMensajeExito(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Tarjetas de Métricas Globales */}
        <section className="plataforma-metricas-grid">
          <div className="plataforma-tarjeta-stat">
            <div className="plataforma-stat-icono verde">
              <Building2 size={24} />
            </div>
            <div>
              <div className="plataforma-stat-valor">{metricas.totalNegocios}</div>
              <div className="plataforma-stat-etiqueta">Locales / Cuentas Activas</div>
            </div>
          </div>

          <div className="plataforma-tarjeta-stat">
            <div className="plataforma-stat-icono azul">
              <Users size={24} />
            </div>
            <div>
              <div className="plataforma-stat-valor">{metricas.totalUsuarios}</div>
              <div className="plataforma-stat-etiqueta">Usuarios Registrados en la Red</div>
            </div>
          </div>

          <div className="plataforma-tarjeta-stat">
            <div className="plataforma-stat-icono naranja">
              <TrendingUp size={24} />
            </div>
            <div>
              <div className="plataforma-stat-valor">{metricas.totalVentas}</div>
              <div className="plataforma-stat-etiqueta">Ventas Registradas Globales</div>
            </div>
          </div>
        </section>

        {/* Barra de Filtros y Acción */}
        <div className="plataforma-barra-acciones">
          <div className="plataforma-busqueda-wrap">
            <Search size={18} />
            <input
              type="text"
              className="plataforma-busqueda-input"
              placeholder="Buscar local por nombre, nave, dueño o usuario..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>

          <button
            onClick={() => setModalNuevoNegocio(true)}
            className="btn btn-p"
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.65rem 1.15rem' }}
          >
            <Plus size={18} />
            <span>+ Nuevo Local / Bodega</span>
          </button>
        </div>

        {/* Grid de Locales */}
        {cargando ? (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--texto-2)' }}>
            <Loader2 size={32} className="anim-girar" style={{ margin: '0 auto 0.75rem' }} />
            <p>Cargando información de la plataforma...</p>
          </div>
        ) : negociosFiltrados.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '3rem 1.5rem',
              background: 'var(--superficie)',
              borderRadius: 'var(--radio-m)',
              border: '1px solid var(--borde)',
            }}
          >
            <Building2 size={40} style={{ color: 'var(--texto-3)', marginBottom: '0.75rem' }} />
            <h3 style={{ margin: 0, fontWeight: 700 }}>No se encontraron locales</h3>
            <p style={{ color: 'var(--texto-2)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              {busqueda
                ? 'Prueba ajustando los términos de búsqueda.'
                : 'Da de alta el primer local o bodega usando el botón "+ Nuevo Local / Bodega".'}
            </p>
          </div>
        ) : (
          <section className="plataforma-negocios-grid">
            {negociosFiltrados.map((n) => (
              <div key={n.id} className="plataforma-card-negocio">
                <div className="plataforma-card-header">
                  <div>
                    <h2 className="plataforma-card-nombre">{n.nombre}</h2>
                    <div className="plataforma-card-ubicacion">
                      <MapPin size={14} />
                      <span>{n.ubicacion || 'Sin ubicación especificada'}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleAbrirEditar(n)}
                    className="btn btn-q"
                    style={{ padding: '0.35rem 0.5rem' }}
                    title="Editar configuración del local"
                  >
                    <Edit2 size={14} />
                  </button>
                </div>

                <div className="plataforma-card-detalles">
                  <div className="plataforma-detalle-fila">
                    <span style={{ color: 'var(--texto-2)' }}>Dueño:</span>
                    <span style={{ fontWeight: 600 }}>
                      {n.dueno ? `${n.dueno.nombre} (@${n.dueno.usuario})` : 'Sin dueño asignado'}
                    </span>
                  </div>

                  {n.telefono && (
                    <div className="plataforma-detalle-fila">
                      <span style={{ color: 'var(--texto-2)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Phone size={12} /> Teléfono:
                      </span>
                      <span>{n.telefono}</span>
                    </div>
                  )}

                  <div className="plataforma-detalle-fila">
                    <span style={{ color: 'var(--texto-2)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Calendar size={12} /> Alta:
                    </span>
                    <span>{new Date(n.creadoEn).toLocaleDateString('es-MX')}</span>
                  </div>
                </div>

                <div className="plataforma-card-metricas">
                  <div className="plataforma-mini-stat">
                    <span className="plataforma-mini-stat-val">{n.totalUsuarios}</span>
                    <span className="plataforma-mini-stat-lbl">Usuarios</span>
                  </div>
                  <div className="plataforma-mini-stat">
                    <span className="plataforma-mini-stat-val">{n.totalVentas}</span>
                    <span className="plataforma-mini-stat-lbl">Ventas Totales</span>
                  </div>
                </div>

                <div className="plataforma-card-acciones">
                  <button
                    onClick={() => handleAbrirUsuarios(n)}
                    className="btn btn-p"
                    style={{ width: '100%', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                  >
                    <Users size={15} />
                    <span>Gestionar Usuarios ({n.totalUsuarios})</span>
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}
      </main>

      {/* Modal: Crear Nuevo Local */}
      {modalNuevoNegocio && (
        <div className="plataforma-modal-fondo">
          <div className="plataforma-modal-caja">
            <div className="plataforma-modal-cabecera">
              <h3 className="plataforma-modal-titulo">Alta de Nuevo Local / Bodega</h3>
              <button
                onClick={() => setModalNuevoNegocio(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCrearNegocio}>
              <div className="plataforma-modal-cuerpo">
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-primario)' }}>
                  1. Información del Local / Bodega
                </div>

                <div>
                  <label className="campo-label">Nombre del negocio o bodega *</label>
                  <input
                    className="campo-input"
                    required
                    placeholder="Ej. Frutas Don Pepe · Nave C"
                    value={formNegocio.nombre}
                    onChange={(e) => setFormNegocio({ ...formNegocio, nombre: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="campo-label">Ubicación</label>
                    <input
                      className="campo-input"
                      placeholder="Ej. Andén 3, Bodega 45"
                      value={formNegocio.ubicacion}
                      onChange={(e) => setFormNegocio({ ...formNegocio, ubicacion: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="campo-label">Teléfono</label>
                    <input
                      className="campo-input"
                      placeholder="Ej. 55 1234 5678"
                      value={formNegocio.telefono}
                      onChange={(e) => setFormNegocio({ ...formNegocio, telefono: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-primario)', marginTop: '0.5rem' }}>
                  2. Usuario Dueño Inicial
                </div>

                <div>
                  <label className="campo-label">Nombre del Dueño *</label>
                  <input
                    className="campo-input"
                    required
                    placeholder="Ej. José Pérez"
                    value={formNegocio.duenoNombre}
                    onChange={(e) => setFormNegocio({ ...formNegocio, duenoNombre: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="campo-label">Usuario de acceso *</label>
                    <input
                      className="campo-input"
                      required
                      placeholder="Ej. joseperez"
                      value={formNegocio.duenoUsuario}
                      onChange={(e) => setFormNegocio({ ...formNegocio, duenoUsuario: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="campo-label">Contraseña inicial *</label>
                    <input
                      type="password"
                      className="campo-input"
                      required
                      minLength={8}
                      placeholder="Mínimo 8 caracteres"
                      value={formNegocio.duenoClave}
                      onChange={(e) => setFormNegocio({ ...formNegocio, duenoClave: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="plataforma-modal-pie">
                <button
                  type="button"
                  className="btn btn-q"
                  onClick={() => setModalNuevoNegocio(false)}
                  disabled={guardando}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-p" disabled={guardando}>
                  {guardando ? 'Creando local...' : 'Registrar Local y Dueño'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Local */}
      {negocioParaEditar && (
        <div className="plataforma-modal-fondo">
          <div className="plataforma-modal-caja">
            <div className="plataforma-modal-cabecera">
              <h3 className="plataforma-modal-titulo">Editar Local: {negocioParaEditar.nombre}</h3>
              <button
                onClick={() => setNegocioParaEditar(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleGuardarEdicion}>
              <div className="plataforma-modal-cuerpo">
                <div>
                  <label className="campo-label">Nombre del negocio *</label>
                  <input
                    className="campo-input"
                    required
                    value={formEditar.nombre}
                    onChange={(e) => setFormEditar({ ...formEditar, nombre: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="campo-label">Ubicación</label>
                    <input
                      className="campo-input"
                      value={formEditar.ubicacion}
                      onChange={(e) => setFormEditar({ ...formEditar, ubicacion: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="campo-label">Teléfono</label>
                    <input
                      className="campo-input"
                      value={formEditar.telefono}
                      onChange={(e) => setFormEditar({ ...formEditar, telefono: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="campo-label">Ventana Offline (horas)</label>
                    <input
                      type="number"
                      className="campo-input"
                      min={1}
                      max={72}
                      value={formEditar.ventanaOfflineHoras}
                      onChange={(e) => setFormEditar({ ...formEditar, ventanaOfflineHoras: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="campo-label">Plazo de crédito (días)</label>
                    <input
                      type="number"
                      className="campo-input"
                      min={1}
                      max={120}
                      value={formEditar.plazoCreditoDias}
                      onChange={(e) => setFormEditar({ ...formEditar, plazoCreditoDias: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>

              <div className="plataforma-modal-pie">
                <button
                  type="button"
                  className="btn btn-q"
                  onClick={() => setNegocioParaEditar(null)}
                  disabled={guardando}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-p" disabled={guardando}>
                  {guardando ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Gestión de Usuarios del Local */}
      {negocioUsuarios && (
        <div className="plataforma-modal-fondo">
          <div className="plataforma-modal-caja ancho-grande">
            <div className="plataforma-modal-cabecera">
              <div>
                <h3 className="plataforma-modal-titulo">Usuarios: {negocioUsuarios.nombre}</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--texto-2)' }}>
                  Administración de accesos para este local
                </span>
              </div>
              <button
                onClick={() => setNegocioUsuarios(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="plataforma-modal-cuerpo">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  Total de usuarios: {usuariosLocal.length}
                </span>
                <button
                  onClick={() => setModalNuevoUsuario(true)}
                  className="btn btn-p"
                  style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Plus size={15} />
                  <span>+ Agregar Usuario a esta Bodega</span>
                </button>
              </div>

              {cargandoUsuarios ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <Loader2 size={24} className="anim-girar" />
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="plataforma-tabla-usuarios">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Usuario</th>
                        <th>Rol</th>
                        <th>Estado</th>
                        <th>Última Actividad</th>
                        <th style={{ textAlign: 'right' }}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usuariosLocal.map((u) => (
                        <tr key={u.id}>
                          <td style={{ fontWeight: 600 }}>{u.nombre}</td>
                          <td>
                            <code style={{ fontSize: '0.85rem' }}>@{u.usuario}</code>
                          </td>
                          <td>
                            <span className="plataforma-badge rol">
                              {u.rolNombre || u.rolBase || 'Usuario'}
                            </span>
                          </td>
                          <td>
                            <span className={`plataforma-badge ${u.activo ? 'activo' : 'inactivo'}`}>
                              {u.activo ? 'Activo' : 'Suspendido'}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--texto-2)' }}>
                            {u.ultimaActividad
                              ? new Date(u.ultimaActividad).toLocaleString('es-MX', {
                                  dateStyle: 'short',
                                  timeStyle: 'short',
                                })
                              : 'Sin actividad'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.35rem' }}>
                              <button
                                onClick={() => handleToggleEstadoUsuario(u)}
                                className="btn btn-q"
                                style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}
                                title={u.activo ? 'Suspender acceso' : 'Reactivar acceso'}
                              >
                                {u.activo ? <UserX size={14} /> : <UserCheck size={14} />}
                              </button>
                              <button
                                onClick={() => setUsuarioParaResetClave(u)}
                                className="btn btn-q"
                                style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}
                                title="Restablecer contraseña"
                              >
                                <KeyRound size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="plataforma-modal-pie">
              <button className="btn btn-q" onClick={() => setNegocioUsuarios(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submodal: Agregar Usuario a Local */}
      {modalNuevoUsuario && (
        <div className="plataforma-modal-fondo" style={{ zIndex: 110 }}>
          <div className="plataforma-modal-caja">
            <div className="plataforma-modal-cabecera">
              <h3 className="plataforma-modal-titulo">Nuevo Usuario para {negocioUsuarios?.nombre}</h3>
              <button
                onClick={() => setModalNuevoUsuario(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCrearUsuario}>
              <div className="plataforma-modal-cuerpo">
                <div>
                  <label className="campo-label">Nombre completo *</label>
                  <input
                    className="campo-input"
                    required
                    placeholder="Ej. Roberto Sánchez"
                    value={formUsuario.nombre}
                    onChange={(e) => setFormUsuario({ ...formUsuario, nombre: e.target.value })}
                  />
                </div>

                <div>
                  <label className="campo-label">Nombre de usuario (login) *</label>
                  <input
                    className="campo-input"
                    required
                    placeholder="Ej. robertos"
                    value={formUsuario.usuario}
                    onChange={(e) => setFormUsuario({ ...formUsuario, usuario: e.target.value })}
                  />
                </div>

                <div>
                  <label className="campo-label">Rol en el local *</label>
                  <select
                    className="campo-input"
                    value={formUsuario.rolBase}
                    onChange={(e) =>
                      setFormUsuario({
                        ...formUsuario,
                        rolBase: e.target.value as 'administrador' | 'trabajador' | 'dueno',
                      })
                    }
                  >
                    <option value="trabajador">Trabajador (Ventas, inventario operativo)</option>
                    <option value="administrador">Administrador (Control total de operaciones)</option>
                    <option value="dueno">Dueño (Titular de la bodega)</option>
                  </select>
                </div>

                <div>
                  <label className="campo-label">Contraseña inicial *</label>
                  <input
                    type="password"
                    className="campo-input"
                    required
                    minLength={6}
                    placeholder="Mínimo 6 caracteres"
                    value={formUsuario.contrasena}
                    onChange={(e) => setFormUsuario({ ...formUsuario, contrasena: e.target.value })}
                  />
                </div>
              </div>

              <div className="plataforma-modal-pie">
                <button
                  type="button"
                  className="btn btn-q"
                  onClick={() => setModalNuevoUsuario(false)}
                  disabled={guardando}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-p" disabled={guardando}>
                  {guardando ? 'Guardando...' : 'Crear Usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Submodal: Resetear Clave de Usuario */}
      {usuarioParaResetClave && (
        <div className="plataforma-modal-fondo" style={{ zIndex: 110 }}>
          <div className="plataforma-modal-caja">
            <div className="plataforma-modal-cabecera">
              <h3 className="plataforma-modal-titulo">Restablecer Contraseña</h3>
              <button
                onClick={() => {
                  setUsuarioParaResetClave(null);
                  setNuevaClave('');
                }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleResetClave}>
              <div className="plataforma-modal-cuerpo">
                <p style={{ margin: 0, fontSize: '0.875rem' }}>
                  Estás a punto de cambiar la contraseña del usuario{' '}
                  <strong>@{usuarioParaResetClave.usuario}</strong> ({usuarioParaResetClave.nombre}).
                </p>

                <div>
                  <label className="campo-label">Nueva contraseña *</label>
                  <input
                    type="password"
                    className="campo-input"
                    required
                    minLength={6}
                    placeholder="Escribe la nueva contraseña..."
                    value={nuevaClave}
                    onChange={(e) => setNuevaClave(e.target.value)}
                    autoFocus
                  />
                </div>
              </div>

              <div className="plataforma-modal-pie">
                <button
                  type="button"
                  className="btn btn-q"
                  onClick={() => {
                    setUsuarioParaResetClave(null);
                    setNuevaClave('');
                  }}
                  disabled={guardando}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn btn-p" disabled={guardando}>
                  {guardando ? 'Actualizando...' : 'Confirmar Nueva Contraseña'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
