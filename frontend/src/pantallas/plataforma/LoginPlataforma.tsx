import { ShieldCheck, KeyRound, ArrowLeft, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { guardarTokenPlataforma, verificarTokenPlataforma } from '../../api/plataforma';
import './plataforma.css';

export default function LoginPlataforma() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError('Introduce la llave o token de Superadministrador.');
      return;
    }

    setCargando(true);
    setError(null);

    try {
      const ok = await verificarTokenPlataforma(token.trim());
      if (ok) {
        guardarTokenPlataforma(token.trim());
        navigate('/plataforma');
      } else {
        setError('Token de plataforma inválido o no autorizado.');
      }
    } catch (err) {
      setError((err as Error).message || 'No se pudo conectar con el servidor.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="plataforma-login-pantalla">
      <div className="plataforma-login-card">
        <div className="plataforma-login-header">
          <div className="plataforma-login-icono">
            <ShieldCheck size={32} />
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, color: 'var(--texto)' }}>
            MiCentralMX Plataforma
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--texto-2)', margin: 0 }}>
            Acceso SuperAdmin · Red de Bodegas y Locales
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--error-fondo)',
              color: 'var(--error-texto)',
              borderRadius: 'var(--radio-s)',
              fontSize: '0.85rem',
              fontWeight: 500,
              border: '1px solid rgba(197, 60, 60, 0.2)',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label
              htmlFor="token-plataforma"
              style={{
                display: 'block',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--texto)',
                marginBottom: '0.4rem',
              }}
            >
              Llave Maestra de Plataforma (Token)
            </label>
            <div style={{ position: 'relative' }}>
              <KeyRound
                size={18}
                style={{
                  position: 'absolute',
                  left: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--texto-3)',
                }}
              />
              <input
                id="token-plataforma"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Ingresa el PLATAFORMA_TOKEN..."
                disabled={cargando}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.75rem 0.65rem 2.4rem',
                  border: '1px solid var(--borde)',
                  borderRadius: 'var(--radio-s)',
                  fontSize: '0.9rem',
                  background: 'var(--gris-2)',
                }}
                autoFocus
              />
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--texto-3)', marginTop: '0.35rem' }}>
              Corresponde a la variable <code style={{ fontSize: '0.75rem' }}>PLATAFORMA_TOKEN</code> configurada en el servidor.
            </p>
          </div>

          <button
            type="submit"
            className="btn btn-p"
            disabled={cargando}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '0.75rem',
              fontSize: '0.95rem',
              fontWeight: 600,
            }}
          >
            {cargando ? (
              <>
                <Loader2 size={18} className="anim-girar" />
                Verificando credenciales...
              </>
            ) : (
              'Ingresar al Panel SuperAdmin'
            )}
          </button>
        </form>

        <div style={{ textAlign: 'center', borderTop: '1px solid var(--gris-1)', paddingTop: '1rem' }}>
          <Link
            to="/login"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.85rem',
              color: 'var(--color-primario)',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <ArrowLeft size={16} />
            Volver al inicio de sesión de bodega
          </Link>
        </div>
      </div>
    </div>
  );
}
