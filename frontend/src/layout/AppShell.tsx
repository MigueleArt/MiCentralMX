import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronsLeft, ChevronsRight, Lock } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useSesionActiva } from '../auth/SesionContext';
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

function Rail() {
  const { pathname } = useLocation();
  const vencidas = useVencidas();
  return (
    <nav className="rail" aria-label="Navegación principal">
      <div style={{ padding: '4px 0 12px' }}>
        <Logotipo tamano={36} />
      </div>
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

function BarraLateral() {
  const { pathname } = useLocation();
  const { sesion } = useSesionActiva();
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
  const { soloLectura, venceEn } = useSesionActiva();
  const conNav = formato === 'telefono' && CON_NAV.includes(pathname);
  return (
    <div className="app">
      {formato === 'tablet' && <Rail />}
      {formato === 'pc' && <BarraLateral />}
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
  );
}
