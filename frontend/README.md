# MiCentralMX · Frontend (PWA)

PWA offline-first en React 19, Vite 8 y TypeScript. Usa Dexie (IndexedDB), TanStack Query, React Router 7, Zod, decimal.js, vite-plugin-pwa y lucide-react. Las reglas del negocio están resumidas en la [sección 5 del README principal](../README.md#5-reglas-del-negocio-y-funcionamiento).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm install` | En la **raíz** del repositorio: instala los tres paquetes (espacios de trabajo). |
| `npm run dev` | Desarrollo contra la API real en `/api`. El proxy de Vite apunta a `http://localhost:3000`. |
| `npm run dev:demo` | Desarrollo con el **servidor de demostración** dentro del navegador, sin backend. |
| `npm run build` / `npm run build:demo` | Compilación de producción. La normal no incluye `src/demo`. |
| `npm run typecheck` | Revisión de tipos. |
| `npm test` | Pruebas del núcleo offline con Vitest y fake-indexeddb. |

**Modo demo:** usuarios `rodolfo` (Dueño), `ana` (Administrador), `carlos` y `luis` (Trabajador); contraseña `demo1234`. La app muestra un banner de "Modo demostración". Ese servidor implementa el mismo contrato HTTP que debe cumplir la API real, pero **no la sustituye**.

## Estructura

```
src/
  db/           Base local Dexie: snapshot del servidor, cola de operaciones y bloques de folios
  dominio/      Operaciones offline, operaciones en línea, consultas, folios y resúmenes
  sync/         Motor de sincronización (push/pull), conectividad y eventos
  auth/         Sesión, ventana offline de 24 h y permisos
  api/          Cliente HTTP con access token en memoria y refresh por cookie
  componentes/  Componentes reutilizables (formularios, insignias, hojas, sincronización…)
  layout/       Shell: barra inferior (teléfono), rail (tablet) y barra lateral (PC)
  pantallas/    Una carpeta por módulo; un archivo por pantalla
  styles/       tokens.css, componentes.css (portado del prototipo) y layout.css
  demo/         Servidor de demostración (solo en modo demo y pruebas)
  pruebas/      Pruebas de Vitest
```

El contrato con la API (entidades, sobre de sincronización y permisos) vive en `packages/shared` y se importa como `@micentralmx/shared/api`, `@micentralmx/shared/entidades` y `@micentralmx/shared/permisos`.

## Pantallas

La numeración es la del prototipo UI/UX con el que se diseñó la app (36 pantallas de teléfono, 2 de tablet y 5 de PC).

| # | Pantalla | Archivo |
|---|---|---|
| 00 | Login | `pantallas/Login.tsx` |
| 01 · PC | Inicio | `pantallas/inicio/Inicio.tsx` |
| 02 | Más | `pantallas/mas/Mas.tsx` |
| 03 | Sin conexión | `BannerSinConexion` en `componentes/Sincronizacion.tsx` |
| 04 | Sincronización | `HojaSincronizacion` en `componentes/Sincronizacion.tsx` |
| 05 · Tablet · PC | Ventas | `pantallas/ventas/Ventas.tsx`, `ListaVentas.tsx` |
| 06 | Ventas · Filtros | `pantallas/ventas/FiltrosVentas.tsx` |
| 07 · PC | Nueva venta | `pantallas/ventas/NuevaVenta.tsx` |
| 08 | Venta registrada | `pantallas/ventas/VentaRegistrada.tsx` |
| 09 | Detalle de venta | `pantallas/ventas/DetalleVenta.tsx` |
| 10 · Tablet · PC | Deudas | `pantallas/deudas/Deudas.tsx` (maestro-detalle en tablet y PC) |
| 11, 13 | Detalle de deuda, Pago registrado | `pantallas/deudas/DetalleDeuda.tsx` |
| 12 | Registrar pago | `pantallas/deudas/RegistrarPago.tsx` (+ `Cobrar.tsx` desde Inicio o Cliente) |
| 14 | Historial de deuda | `pantallas/deudas/HistorialDeuda.tsx` |
| 15 · PC | Inventario | `pantallas/inventario/Inventario.tsx` (+ `AlertasConciliacion.tsx`: existencias que no coinciden con su historial) |
| 16 | Detalle de producto | `pantallas/inventario/DetalleProducto.tsx` |
| 17, 18, 35 | Crear / Editar producto, Acción destructiva | `pantallas/inventario/FormProducto.tsx` (archivar en lugar de eliminar) |
| 19 | Mermas / Ajustes | `pantallas/inventario/MermasAjustes.tsx` |
| 20 | Clientes | `pantallas/clientes/Clientes.tsx` |
| 21 | Detalle de cliente | `pantallas/clientes/DetalleCliente.tsx` (+ `FormCliente.tsx`) |
| 22 | Proveedores | `pantallas/proveedores/Proveedores.tsx` (+ `FormProveedor.tsx`) |
| 23 | Compras | `pantallas/compras/Compras.tsx` |
| 24 | Crear compra | `pantallas/compras/NuevaCompra.tsx` |
| 25 | Pagos | `pantallas/pagos/Pagos.tsx` (+ `RegistrarMovimiento.tsx`) |
| 26 | Reportes | `pantallas/reportes/Reportes.tsx` |
| 27 | Usuarios | `pantallas/usuarios/Usuarios.tsx` |
| 28 | Historial | `pantallas/historial/Historial.tsx` |
| 29 | Configuración | `pantallas/configuracion/Configuracion.tsx` |
| 30, 31 | Estado vacío, Sin resultados | `EstadoVacio` en `componentes/Estados.tsx` |
| 32 | Error de validación | Estado de `NuevaVenta.tsx` |
| 33 | Error al guardar | Diálogo de `NuevaVenta.tsx` (solo ante falla de IndexedDB, nunca por falta de red) |
| 34 | Cargando | `Esqueleto` en `componentes/Estados.tsx` |
| — | Revisiones (agregada después del prototipo) | `pantallas/revisiones/Revisiones.tsx`: aprobar, reaplicar o descartar operaciones que llegaron con observaciones |

## Backend

El contrato (`@micentralmx/shared`, en `packages/shared`) lo implementa la API de [`backend/`](../backend/README.md): Express, PostgreSQL 18 con RLS y migraciones en `database/`. En desarrollo, `npm run dev` manda `/api` a `http://localhost:3000`. `src/demo/servidor.ts` sigue disponible para trabajar sin base de datos (`npm run dev:demo`).
