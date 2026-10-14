import { CircleAlert, Eye, EyeOff, LoaderCircle, Wifi, WifiOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { mensajeError } from '../api/cliente';
import { iniciarSesion } from '../auth/sesion';
import { useSesion } from '../auth/SesionContext';
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
  const [olvido, setOlvido] = useState(false);

  if (sesion) return <Navigate to="/" replace />;

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    if (!usuario.trim() || !contrasena) {
      setError('Escribe tu usuario y tu contraseña.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      await iniciarSesion(usuario.trim(), contrasena);
      await sincronizar();
      navegar('/', { replace: true });
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
            <Entrada id="u" type="text" autoComplete="username" placeholder="Ej. 55 1234 5678" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
          </Campo>
          <Campo etiqueta="Contraseña" id="p">
            <div style={{ position: 'relative' }}>
              <Entrada
                id="p"
                type={ver ? 'text' : 'password'}
                autoComplete="current-password"
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
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

        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'center' }}>
          <span className={`sync ${enLinea ? 's-on' : 's-off'}`} style={{ cursor: 'default' }}>
            {enLinea ? <Wifi className="ic" /> : <WifiOff className="ic" />}
            {enLinea ? 'Conectado' : 'Sin conexión'}
          </span>
        </div>
      </main>
    </div>
  );
}
