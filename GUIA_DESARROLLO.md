# Guía de Puesta en Marcha y Desarrollo (Modo Real sin Demo) · MiCentralMX

Esta guía explica paso a paso cómo levantar el entorno completo de desarrollo con **PostgreSQL real**, la **API backend** y la **PWA frontend** enlazados sin simulación en memoria (sin modo demo), para probar los flujos de negocio completos (cargas, ventas, inventario, mermas, pagos y liquidación a productores).

---

## 1. Requisitos Previos

- **Node.js**: Versión 20 o 22 LTS (recomendada).
- **npm**: Versión 10+ (con soporte para *workspaces*).
- **PostgreSQL**: Versión 15, 16, 17 o 18 ejecutándose en local (puerto 5432 o el configurado).
  - Puede estar en Windows nativo, en WSL (Ubuntu) o en un contenedor Docker:
    ```bash
    # Ejemplo con Docker en local si no tienes Postgres nativo:
    docker run --name mc_postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:18-alpine
    ```

---

## 2. Configuración de la Base de Datos

### A. Roles y Base de Datos
PostgreSQL utiliza Row Level Security (RLS) para aislar negocios. La aplicación se conecta como `mc_app` (sin privilegios de bypass RLS), y las migraciones/plataforma como `mc_plataforma`.

1. Abre `psql` como superusuario (`postgres`):
   ```bash
   psql -U postgres -h localhost
   ```
2. Ejecuta el script de roles iniciales [`database/inicial/01_roles.sql`](database/inicial/01_roles.sql):
   ```sql
   \i database/inicial/01_roles.sql
   ```
   *(Este script crea los roles `mc_plataforma`, `mc_app`, `mc_anon` y la base de datos `micentralmx`).*

3. Para las pruebas automatizadas del backend, crea también la base de datos de pruebas si no existe:
   ```sql
   create database micentralmx_prueba owner mc_plataforma;
   grant all privileges on database micentralmx_prueba to mc_plataforma;
   ```

### B. Variables de Entorno del Backend
Copia la plantilla de entorno en `backend/.env`:

```env
PUERTO=3000
DATABASE_URL="postgres://mc_app:app12345@localhost:5432/micentralmx"
DATABASE_OWNER_URL="postgres://mc_plataforma:plat12345@localhost:5432/micentralmx"
JWT_SECRET="desarrollo-secreto-cambiar-en-produccion-1234567890"
CORS_ORIGEN="http://localhost:5173"
```

*(Si utilizas otro puerto de Postgres como 5433 o contraseñas distintas, ajusta las URLs en `.env` y `.env.test`).*

### C. Aplicar Migraciones y Semilla de Datos

Desde la raíz del proyecto o desde `backend/`:

```bash
# 1. Instalar dependencias en la raíz
npm install

# 2. Correr migraciones en PostgreSQL (aplica desde 0001 hasta 0010_liquidacion_merma.sql)
npm run db:migrar --workspace backend

# 3. Cargar datos de prueba (Negocio "Bodega Hernández · Nave I", productos, clientes y productores)
npm run db:semilla --workspace backend
```

---

## 3. Iniciar el Proyecto en Modo Desarrollo

Para trabajar en modo real (con base de datos y backend conectados, **sin modo demo**):

### Terminal 1: Backend (API Express + Drizzle)
```bash
cd backend
npm run dev
```
- La API estará escuchando en `http://localhost:3000/api`.

### Terminal 2: Frontend (PWA React + Vite)
```bash
cd frontend
npm run dev
```
- La PWA abrirá en `http://localhost:5173`.
- **Importante**: Ejecuta `npm run dev` y **NO** `npm run dev:demo`. El comando `npm run dev` se conecta al backend real mediante el proxy de Vite configurado en `vite.config.ts`.
- Verifica que en la esquina superior **NO** aparezca el aviso amarillo de "Modo demostración".

---

## 4. Usuarios y Roles de Prueba

La semilla de desarrollo crea usuarios preconfigurados. La contraseña para todos es: **`demo1234`**.

| Usuario | Rol | Permisos Principales |
|---|---|---|
| `rodolfo` | **Dueño** | Acceso total al negocio. Emisión de cortes, gestión de comisiones, altas de catálogo y reportes. |
| `ana` | **Administrador** | Acceso total operativo. Gestión de liquidaciones, revisión de operaciones offline, auditoría y cierres. |
| `carlos` | **Trabajador** | Ventas, cobros, consultas de inventario y alta de clientes. No tiene acceso a `liquidaciones.gestionar` ni cambios de comisiones. |
| `luis` | **Trabajador** | Mismo rol operativo que Carlos. |

---

## 5. Casos de Uso y Flujos Principales para Probar

### A. Registrar una Carga de Fruta
1. Entra como `rodolfo` o `ana`.
2. Ve a **Inventario** o **Productores** → Cargas del día → **Nueva Carga**.
3. Selecciona el productor (ej. "Agrícola San Juan") y captura las cantidades por clasificación (ej. 50 cajas de Primera).
4. La carga queda en estado `abierta`.

### B. Vender de la Carga
1. Entra a **Vender** (`/ventas/nueva`).
2. Agrega el producto ingresado en la carga.
3. Observa cómo el sistema asigna automáticamente la fruta a la carga abierta más antigua (FIFO). Puedes cambiar manualmente el origen si es necesario.
4. Completa la venta en efectivo o crédito. El inventario general y las existencias de la carga se descuentan en tiempo real.

### C. Mermas de Carga
1. En **Inventario** → **Mermas** → Nueva merma.
2. Asocia la merma a la carga abierta de ese productor.
3. Esta merma se guarda con su `movimiento_id` y queda disponible para su cobro sugerido en el próximo corte.

### D. Emitir Liquidación / Corte a Productor
1. Ve a **Productores** → Selecciona al productor → **Nuevo Corte** (`/proveedores/:id/corte/nuevo`).
2. Selecciona las ventas realizadas de sus cargas.
3. El sistema muestra las mermas pendientes asociadas a esas cargas. Al agregar una merma, se enlaza su `movimiento_id`.
4. Define la comisión:
   - Puede ser fija por porcentaje o por unidad.
   - Si se incluyen cargas con comisiones distintas, el sistema calcula la comisión proporcional y la clasifica automáticamente como `'mixta'`.
   - La comisión final debe satisfacer: `0 <= comision_final <= total_vendido`.
5. Emite el corte: se genera el folio inmutable `#L-0001`, bloqueando concurrentemente las ventas incluidas con `FOR UPDATE`.

### E. Estado de Cuenta y Pagos
1. En el perfil del productor, revisa el **Estado de Cuenta**.
2. **Regla de Saldos y FIFO**:
   - Los pagos y anticipos (`pago_proveedor`, `anticipo_productor`) se aplican por antigüedad (FIFO) a los cortes pendientes.
   - Los cargos y abonos (`ajustes_productor`) ajustan el saldo global de la cuenta, sin alterar el estado individual de cada corte.
   - Los pagos asociados a compras a crédito no afectan la cuenta de consigna del productor.
3. Registra abonos, anticipos o ajustes y observa la actualización inmediata del saldo.

---

## 6. Verificación Automatizada

Para verificar que todos los tipos y pruebas pasen correctamente:

```bash
# Verificación de TypeScript en todo el monorepo
npm run typecheck

# Pruebas unitarias y de integración (incluye PostgreSQL real en backend)
npm test
```
