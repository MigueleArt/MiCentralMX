import { CircleAlert, Eye, EyeOff, LoaderCircle, Wifi, WifiOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, Link } from 'react-router';
import { mensajeError } from '../api/cliente';
import { iniciarSesion } from '../auth/sesion';
import { useSesion } from '../auth/SesionContext';
import { validarLogin, type ErroresLogin } from '../auth/validarLogin';
import { AvisoLinea } from '../componentes/Estados';
import { Campo, Entrada } from '../componentes/Formulario';
import { Marca } from '../componentes/Marca';
import { MODO_DEMO } from '../config';
import { useConectividad } from '../sync/conectividad';
import { sincronizar } from '../sync/motor';

/** Pantalla 00 · Login. El inicio de sesión siempre requiere conexión (decisiones técnicas §4.3). */
export default function Login() {
  const { sesion } = useSesion();
  const { enLinea } = useConectividad();
  const navegar = useNavigate();
  const [usuario, setUsuario] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [ver, setVer] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [erroresCampos, setErroresCampos] = useState<ErroresLogin>({});
  const [olvido, setOlvido] = useState(false);

  if (sesion) return <Navigate to="/" replace />;

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    const errores = validarLogin(usuario, contrasena);
    setErroresCampos(errores);
    if (Object.keys(errores).length > 0) {
      setError('Completa la información indicada.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await iniciarSesion(usuario.trim(), contrasena);
      navegar('/', { replace: true });
      void sincronizar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{ minHeight: '100dvh', background: '#fff', display: 'flex', justifyContent: 'center' }}>
      <main style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', padding: '56px 24px 24px', gap: 32 }}>
        <div className="pila" style={{ gap: 20 }}>
          <Marca tamano={44} texto={26} />
          <div>
            <h1 className="t-title">Inicia sesión</h1>
            <p className="t-2" style={{ marginTop: 4, fontSize: 16, lineHeight: '24px' }}>
              Entra para registrar ventas, inventario y cobros de tu negocio.
            </p>
          </div>
        </div>

        <form className="pila-16" onSubmit={entrar} noValidate>
          <Campo etiqueta="Usuario o teléfono" id="u">
            <Entrada
              id="u"
              type="text"
              autoComplete="username"
              placeholder="Ej. 55 1234 5678"
              value={usuario}
              aria-invalid={!!erroresCampos.usuario}
              aria-describedby={erroresCampos.usuario ? 'u-error' : undefined}
              onChange={(e) => {
                setUsuario(e.target.value);
                if (erroresCampos.usuario) setErroresCampos((actual) => ({ ...actual, usuario: undefined }));
              }}
            />
            {erroresCampos.usuario && <span id="u-error" className="hint" style={{ color: 'var(--error-texto)' }}>{erroresCampos.usuario}</span>}
          </Campo>
          <Campo etiqueta="Contraseña" id="p">
            <div style={{ position: 'relative' }}>
              <Entrada
                id="p"
                type={ver ? 'text' : 'password'}
                autoComplete="current-password"
                value={contrasena}
                aria-invalid={!!erroresCampos.contrasena}
                aria-describedby={erroresCampos.contrasena ? 'p-error' : undefined}
                onChange={(e) => {
                  setContrasena(e.target.value);
                  if (erroresCampos.contrasena) setErroresCampos((actual) => ({ ...actual, contrasena: undefined }));
                }}
                style={{ paddingRight: 52 }}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                onClick={() => setVer(!ver)}
                style={{ position: 'absolute', right: 2, top: 2, color: 'var(--texto-2)' }}
              >
                {ver ? <EyeOff className="ic" /> : <Eye className="ic" />}
              </button>
            </div>
            {erroresCampos.contrasena && <span id="p-error" className="hint" style={{ color: 'var(--error-texto)' }}>{erroresCampos.contrasena}</span>}
          </Campo>

          {!enLinea && (
            <AvisoLinea tono="warn" icono={<WifiOff className="ic" />}>
              Necesitas Internet para iniciar sesión en este dispositivo.
            </AvisoLinea>
          )}
          {error && (
            <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>
              {error}
            </AvisoLinea>
          )}

          <button type="submit" className="btn btn-p btn-lg btn-ancho" style={{ marginTop: 8 }} disabled={enviando || !enLinea}>
            {enviando && <LoaderCircle className="ic girar" />}
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
          <button type="button" className="enlace" style={{ alignSelf: 'center' }} onClick={() => setOlvido(!olvido)} aria-expanded={olvido}>
            ¿Olvidaste tu contraseña?
          </button>
          {olvido && <p className="t-2" style={{ textAlign: 'center' }}>Pide a tu administrador que la restablezca desde Usuarios.</p>}
        </form>

        {MODO_DEMO && (
          <AvisoLinea tono="info">
            <strong>Modo demostración</strong>
            Usuarios: <b>rodolfo</b> (Dueño), <b>ana</b> (Administrador), <b>carlos</b> o <b>luis</b> (Trabajador). Contraseña: <b>demo1234</b>.
          </AvisoLinea>
        )}

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <span className={`sync ${enLinea ? 's-on' : 's-off'}`} style={{ cursor: 'default' }}>
            {enLinea ? <Wifi className="ic" /> : <WifiOff className="ic" />}
            {enLinea ? 'Conectado' : 'Sin conexión'}
          </span>
          <Link
            to="/plataforma/login"
            style={{
              fontSize: '0.8rem',
              color: 'var(--texto-2)',
              textDecoration: 'none',
              padding: '4px 8px',
              borderRadius: 'var(--radio-s)',
              fontWeight: 500,
            }}
          >
            Acceso SuperAdmin · Plataforma
          </Link>
        </div>
      </main>
    </div>
  );
}
