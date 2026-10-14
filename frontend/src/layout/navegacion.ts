import {
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  Ellipsis,
  HandCoins,
  History,
  House,
  Package,
  PackageMinus,
  Receipt,
  Settings,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Permiso } from '@micentralmx/shared/permisos';

export interface Destino {
  ruta: string;
  texto: string;
  icono: LucideIcon;
  permiso?: Permiso;
  /** Muestra la cuenta de deudas vencidas. */
  vencidas?: boolean;
}

const D = {
  inicio: { ruta: '/', texto: 'Inicio', icono: House },
  inventario: { ruta: '/inventario', texto: 'Inventario', icono: Package, permiso: 'inventario.ver' },
  ventas: { ruta: '/ventas', texto: 'Ventas', icono: Receipt },
  deudas: { ruta: '/deudas', texto: 'Deudas', icono: HandCoins, vencidas: true },
  clientes: { ruta: '/clientes', texto: 'Clientes', icono: Users },
  compras: { ruta: '/compras', texto: 'Compras', icono: ShoppingCart, permiso: 'compras.crear' },
  proveedores: { ruta: '/proveedores', texto: 'Proveedores', icono: Truck, permiso: 'compras.crear' },
  pagos: { ruta: '/pagos', texto: 'Pagos', icono: Wallet },
  mermas: { ruta: '/inventario/mermas', texto: 'Mermas', icono: PackageMinus, permiso: 'inventario.merma' },
  reportes: { ruta: '/reportes', texto: 'Reportes', icono: ChartColumn, permiso: 'reportes.ver' },
  usuarios: { ruta: '/usuarios', texto: 'Usuarios', icono: UserCog, permiso: 'usuarios.gestionar' },
  historial: { ruta: '/historial', texto: 'Historial', icono: History, permiso: 'historial.ver' },
  configuracion: { ruta: '/configuracion', texto: 'Configuración', icono: Settings },
  revisiones: { ruta: '/revisiones', texto: 'Revisiones', icono: ClipboardCheck, permiso: 'revisiones.resolver' },
  mas: { ruta: '/mas', texto: 'Más', icono: Ellipsis },
} satisfies Record<string, Destino>;

export const DESTINOS = D;

/** Barra inferior del teléfono (decisiones técnicas §3: Deudas sustituye a Clientes). */
export const NAV_TELEFONO: Destino[] = [D.inicio, D.ventas, D.deudas, D.inventario, D.mas];

/** Rail de tablet, como en el prototipo. */
export const NAV_TABLET: Destino[] = [D.inicio, D.inventario, D.ventas, D.clientes, D.deudas, D.compras, D.pagos, D.mas];

/** Barra lateral de PC, como en el prototipo. */
export const NAV_PC_OPERACION: Destino[] = [D.inicio, D.inventario, D.ventas, D.compras, D.clientes, D.proveedores, D.pagos, D.deudas, D.mermas];
export const NAV_PC_ADMIN: Destino[] = [D.reportes, D.revisiones, D.usuarios, D.historial, D.configuracion];

/** Pantalla "Más" del teléfono. */
export const MAS_OPERACION: Destino[] = [D.clientes, D.compras, D.proveedores, D.pagos, { ...D.mermas, texto: 'Mermas / Ajustes' }];
export const MAS_ADMIN: Destino[] = [D.reportes, D.revisiones, { ...D.usuarios, texto: 'Usuarios' }, D.historial, D.configuracion];

export const ICONO_LISTA = ClipboardList;
