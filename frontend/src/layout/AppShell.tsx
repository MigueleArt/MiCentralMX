import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronsLeft, ChevronsRight, Lock, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useSesionActiva } from '../auth/SesionContext';
import { BuscadorProductosContext, BuscadorRapidoProductos } from '../componentes/BuscadorRapidoProductos';
import { Logotipo, Marca } from '../componentes/Marca';
import { MODO_DEMO } from '../config';
import { deudasVista } from '../dominio/consultas';
import { useFormato } from '../hooks/useFormato';
import { formatoHora } from '../lib/fechas';
import { iniciales } from '../lib/ids';
import { NAV_PC_ADMIN, NAV_PC_OPERACION, NAV_TABLET, NAV_TELEFONO, type Destino } from './navegacion';

/** Rutas con barra inferior en el teléfono; las demás son pantallas secundarias con su propio encabezado. */
const CON_NAV = ['/', '/ventas', '/deudas', '/inventario', '/mas', '/clientes'];

function useVencidas() {
  return useLiveQuery(async () => (await deudasVista()).filter((d) => d.deuda === 'vencida').length) ?? 0;
}

function useVisibles(lista: Destino[]) {
  const { puede } = useSesionActiva();
  return lista.filter((d) => !d.permiso || puede(d.permiso));
}

const activo = (ruta: string, actual: string) => (ruta === '/' ? actual === '/' : actual === ruta || actual.startsWith(`${ruta}/`));

function NavInferior() {
  const { pathname } = useLocation();
  const vencidas = useVencidas();
  return (
    <nav className="nav" aria-label="Navegación principal">
      {useVisibles(NAV_TELEFONO).map((d) => (
        <NavLink key={d.ruta} to={d.ruta} end={d.ruta === '/'} className={activo(d.ruta, pathname) && !(d.ruta === '/inventario' && pathname.startsWith('/inventario/mermas')) ? 'on' : ''}>
          <d.icono className="ic" />
          {d.texto}
          {d.vencidas && vencidas > 0 && <span className="cnt-nav">{vencidas}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

function Rail({ alAbrirBuscador }: { alAbrirBuscador: () => void }) {
  const { pathname } = useLocation();
  const { puede } = useSesionActiva();
  const vencidas = useVencidas();
  return (
    <nav className="rail" aria-label="Navegación principal">
      <div style={{ padding: '4px 0 12px' }}>
        <Logotipo tamano={36} />
      </div>
      {puede('inventario.ver') && (
        <button type="button" className="rail-buscar" onClick={alAbrirBuscador} aria-label="Buscar producto" title="Buscar producto (Ctrl+K)">
          <Search className="ic" />
          <span>Buscar</span>
        </button>
      )}
      {useVisibles(NAV_TABLET).map((d) => (
        <NavLink key={d.ruta} to={d.ruta} end={d.ruta === '/'} className={activo(d.ruta, pathname) ? 'on' : ''}>
          <d.icono className="ic" />
          <span>{d.texto}</span>
          {d.vencidas && vencidas > 0 && <span className="cnt-nav">{vencidas}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

function BarraLateral({ alAbrirBuscador }: { alAbrirBuscador: () => void }) {
  const { pathname } = useLocation();
  const { sesion, puede } = useSesionActiva();
  const vencidas = useVencidas();
  const [contraida, setContraida] = useState(false);
  const operacion = useVisibles(NAV_PC_OPERACION);
  const admin = useVisibles(NAV_PC_ADMIN);
  const enlace = (d: Destino) => (
    <NavLink
      key={d.ruta}
      to={d.ruta}
      end
      className={`it ${activo(d.ruta, pathname) && !(d.ruta === '/inventario' && pathname.startsWith('/inventario/mermas')) ? 'on' : ''}`}
      title={contraida ? d.texto : undefined}
    >
      <d.icono className="ic" />
      {!contraida && d.texto}
      {d.vencidas && vencidas > 0 && (
        <span className="bdg b-err bdg-sm" style={{ marginLeft: 'auto' }}>
          {vencidas}
        </span>
      )}
    </NavLink>
  );
  return (
    <aside className={`side${contraida ? ' contraida' : ''}`} aria-label="Navegación">
      <div className="fila-entre" style={{ padding: '4px 4px 16px 8px' }}>
        {contraida ? <Logotipo tamano={32} /> : <Marca tamano={32} texto={19} />}
        <button type="button" className="icon-btn" aria-label={contraida ? 'Expandir menú' : 'Contraer menú'} onClick={() => setContraida(!contraida)} style={{ color: 'var(--texto-2)' }}>
          {contraida ? <ChevronsRight className="ic" /> : <ChevronsLeft className="ic" />}
        </button>
      </div>
      <nav className="pila" style={{ gap: 2 }}>
        {puede('inventario.ver') && (
          <button
            type="button"
            className="it side-buscar"
            onClick={alAbrirBuscador}
            title={contraida ? 'Buscar producto (Ctrl+K)' : undefined}
          >
            <Search className="ic" />
            {!contraida && (
              <>
                <span>Buscar producto</span>
                <kbd className="kbd-atajo">Ctrl K</kbd>
              </>
            )}
          </button>
        )}
        {operacion.map(enlace)}
        {admin.length > 0 && !contraida && <p className="grp">ADMINISTRACIÓN</p>}
        {admin.map(enlace)}
      </nav>
      <div className="pie">
        <span className="avatar" style={{ width: 36, height: 36 }}>
          {iniciales(sesion.usuario.nombre)}
        </span>
        {!contraida && (
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 14, fontWeight: 600 }}>{sesion.usuario.nombre}</p>
            <p className="t-aux">{sesion.usuario.rolNombre}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

export function AppShell() {
  const formato = useFormato();
  const { pathname } = useLocation();
  const { soloLectura, venceEn, puede } = useSesionActiva();
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const conNav = formato === 'telefono' && CON_NAV.includes(pathname);
  const puedeBuscar = puede('inventario.ver');

  useEffect(() => {
    if (!puedeBuscar) return;
    const alPresionar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setBuscadorAbierto((v) => !v);
      }
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [puedeBuscar]);

  return (
    <BuscadorProductosContext.Provider value={() => setBuscadorAbierto(true)}>
      <div className="app">
        {formato === 'tablet' && <Rail alAbrirBuscador={() => setBuscadorAbierto(true)} />}
        {formato === 'pc' && <BarraLateral alAbrirBuscador={() => setBuscadorAbierto(true)} />}
        <div className={`app-cuerpo${conNav ? ' con-nav' : ''}`}>
          {MODO_DEMO && <p className="banner-modo">Modo demostración: servidor de prueba en este navegador, sin backend real.</p>}
          {soloLectura && (
            <p className="banner-solo-lectura" role="alert">
              <Lock className="ic" style={{ width: 18, height: 18 }} />
              Solo lectura desde las {venceEn ? formatoHora(venceEn) : ''}: pasaron más de 24 horas sin conexión. Conéctate para seguir registrando.
            </p>
          )}
          <Outlet />
        </div>
        {conNav && <NavInferior />}
      </div>
      {buscadorAbierto && <BuscadorRapidoProductos alCerrar={() => setBuscadorAbierto(false)} />}
    </BuscadorProductosContext.Provider>
  );
}
