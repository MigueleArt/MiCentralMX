import { Lock } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createBrowserRouter, Link, Navigate, Outlet } from 'react-router';
import { alExpirarSesion } from './api/cliente';
import { useSesion } from './auth/SesionContext';
import { db } from './db/db';
import { EstadoVacio, Esqueleto } from './componentes/Estados';
import { SincronizacionProvider } from './componentes/Sincronizacion';
import type { Permiso } from '@micentralmx/shared/permisos';
import { AppShell } from './layout/AppShell';
import { iniciarMotor } from './sync/motor';
import Login from './pantallas/Login';
import Inicio from './pantallas/inicio/Inicio';
import Mas from './pantallas/mas/Mas';
import Ventas from './pantallas/ventas/Ventas';
import NuevaVenta from './pantallas/ventas/NuevaVenta';
import VentaRegistrada from './pantallas/ventas/VentaRegistrada';
import DetalleVenta from './pantallas/ventas/DetalleVenta';
import Deudas from './pantallas/deudas/Deudas';
import DetalleDeuda from './pantallas/deudas/DetalleDeuda';
import HistorialDeuda from './pantallas/deudas/HistorialDeuda';
import Cobrar from './pantallas/deudas/Cobrar';
import Inventario from './pantallas/inventario/Inventario';
import DetalleProducto from './pantallas/inventario/DetalleProducto';
import FormProducto from './pantallas/inventario/FormProducto';
import MermasAjustes from './pantallas/inventario/MermasAjustes';
import Clientes from './pantallas/clientes/Clientes';
import DetalleCliente from './pantallas/clientes/DetalleCliente';
import FormCliente from './pantallas/clientes/FormCliente';
import Proveedores from './pantallas/proveedores/Proveedores';
import FormProveedor from './pantallas/proveedores/FormProveedor';
import Compras from './pantallas/compras/Compras';
import NuevaCompra from './pantallas/compras/NuevaCompra';
import Pagos from './pantallas/pagos/Pagos';
import Reportes from './pantallas/reportes/Reportes';
import Usuarios from './pantallas/usuarios/Usuarios';
import Historial from './pantallas/historial/Historial';
import Configuracion from './pantallas/configuracion/Configuracion';
import Revisiones from './pantallas/revisiones/Revisiones';

/** Rutas con sesión: arranca el motor de sincronización mientras haya sesión. */
function Protegida() {
  const { cargando, sesion } = useSesion();
  useEffect(() => {
    if (!sesion) return;
    const detener = iniciarMotor();
    // Si el servidor ya no acepta la sesión se pide iniciar sesión; lo pendiente se conserva.
    const quitar = alExpirarSesion(() => void db.borrarMeta('sesion'));
    return () => {
      detener();
      quitar();
    };
  }, [sesion?.usuario.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (cargando) return <main className="pag-main" style={{ paddingTop: 24 }}><Esqueleto filas={3} /></main>;
  if (!sesion) return <Navigate to="/login" replace />;
  return (
    <SincronizacionProvider>
      <Outlet />
    </SincronizacionProvider>
  );
}

/** La interfaz oculta lo no permitido; la API valida siempre (propuesta §9). */
function Requiere({ permiso, children }: { permiso: Permiso; children: ReactNode }) {
  const { puede } = useSesion();
  if (puede(permiso)) return children;
  return (
    <main className="pag-main" style={{ paddingTop: 24 }}>
      <EstadoVacio icono={Lock} titulo="Sin permiso" texto="Tu rol no permite entrar a esta sección. Pide acceso al administrador." acciones={<Link className="btn btn-q" to="/">Ir a inicio</Link>} />
    </main>
  );
}

const con = (permiso: Permiso, el: ReactNode) => <Requiere permiso={permiso}>{el}</Requiere>;

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    element: <Protegida />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Inicio /> },
          { path: 'mas', element: <Mas /> },
          { path: 'ventas', element: <Ventas /> },
          { path: 'ventas/nueva', element: con('ventas.crear', <NuevaVenta />) },
          { path: 'ventas/:id', element: <DetalleVenta /> },
          { path: 'ventas/:id/registrada', element: <VentaRegistrada /> },
          { path: 'deudas', element: <Deudas /> },
          { path: 'deudas/:id', element: <DetalleDeuda /> },
          { path: 'deudas/:id/historial', element: <HistorialDeuda /> },
          { path: 'cobrar', element: con('pagos.registrar', <Cobrar />) },
          { path: 'inventario', element: con('inventario.ver', <Inventario />) },
          { path: 'inventario/nuevo', element: con('catalogo.editar', <FormProducto />) },
          { path: 'inventario/mermas', element: <MermasAjustes /> },
          { path: 'inventario/:id', element: con('inventario.ver', <DetalleProducto />) },
          { path: 'inventario/:id/editar', element: con('catalogo.editar', <FormProducto />) },
          { path: 'clientes', element: <Clientes /> },
          { path: 'clientes/nuevo', element: con('clientes.crear', <FormCliente />) },
          { path: 'clientes/:id', element: <DetalleCliente /> },
          { path: 'clientes/:id/editar', element: con('clientes.editar', <FormCliente />) },
          { path: 'proveedores', element: con('compras.crear', <Proveedores />) },
          { path: 'proveedores/nuevo', element: con('proveedores.gestionar', <FormProveedor />) },
          { path: 'proveedores/:id/editar', element: con('proveedores.gestionar', <FormProveedor />) },
          { path: 'compras', element: con('compras.crear', <Compras />) },
          { path: 'compras/nueva', element: con('compras.crear', <NuevaCompra />) },
          { path: 'pagos', element: <Pagos /> },
          { path: 'reportes', element: con('reportes.ver', <Reportes />) },
          { path: 'usuarios', element: con('usuarios.gestionar', <Usuarios />) },
          { path: 'historial', element: con('historial.ver', <Historial />) },
          { path: 'configuracion', element: <Configuracion /> },
          { path: 'revisiones', element: con('revisiones.resolver', <Revisiones />) },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
