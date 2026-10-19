# MiCentralMX

PWA para bodegas de la central de abasto: ventas de contado y a crédito, cobranza, inventario por clasificación (Primera, Segunda, Tercera…), compras, mermas, pagos y reportes. **Funciona sin conexión**: las operaciones se guardan en el dispositivo y se sincronizan una sola vez al recuperar Internet. Cada negocio tiene sus datos completamente separados.

| Documento | Para qué |
|---|---|
| [`GUIA_DESARROLLO.md`](GUIA_DESARROLLO.md) | **Guía paso a paso**: cómo correr PostgreSQL real, API y PWA sin modo demo, usuarios de prueba y flujos a validar. |
| Este archivo, [sección 5](#5-reglas-del-negocio-y-funcionamiento) | Reglas aprobadas: folios, stock, sesión offline, sincronización, revisiones, conciliación y seguridad. **Léela antes de cambiar la lógica.** |
| [`frontend/README.md`](frontend/README.md) | PWA: comandos, estructura y mapa de las 43 pantallas a sus archivos. |
| [`backend/README.md`](backend/README.md) | API: puesta en marcha, pruebas, seguridad, bajada paginada y conciliación. |
| [`database/migraciones/`](database/migraciones) | Esquema, RLS y cambios de la base, en orden. |

---

## 1. Estructura

```
MiCentralMX/
├── packages/shared/    @micentralmx/shared: el contrato de la API (entidades, sincronización, permisos)
├── frontend/           PWA: React 19 + Vite + TypeScript + Dexie (IndexedDB)
├── backend/            API: Node.js 22 + Express 5 + TypeScript + Drizzle
├── database/
│   ├── inicial/        01_roles.sql: crea los roles de PostgreSQL y la base (una vez)
│   └── migraciones/    Esquema, RLS y cambios versionados (fuente de verdad de la base)
├── test/               Vacía: las pruebas viven en frontend/src/pruebas y backend/test
├── package.json        Espacios de trabajo de npm (shared, backend, frontend)
├── docker-compose.yml  PostgreSQL + API + Caddy (despliegue)
├── Caddyfile           Sirve la PWA en / y la API en /api desde el mismo dominio
└── .env.example        Variables para docker compose
```

## 2. Stack

| Capa | Tecnología |
|---|---|
| Lenguajes | TypeScript, HTML, CSS, SQL |
| Frontend | React 19, Vite 8, React Router 7, TanStack Query 5, Dexie 4, vite-plugin-pwa, Zod, decimal.js, lucide-react, fuente Inter |
| Backend | Node.js 22, Express 5, Drizzle ORM, pg, Zod, argon2, jsonwebtoken |
| Base de datos | PostgreSQL 18 con Row Level Security |
| Pruebas | Vitest, Supertest, fake-indexeddb |
| Despliegue | Docker Compose + Caddy (HTTPS automático) |

Gestor de paquetes: **npm con espacios de trabajo**. Se instala una sola vez desde la raíz (`npm install`); hay un solo `package-lock.json` y una sola carpeta `node_modules`. Para correr un comando en un paquete: `npm run dev --workspace frontend` o entrar a la carpeta y usar `npm run dev`.

---

## 3. Cómo correrlo

### Opción A · Solo frontend, sin base de datos (modo demo)

La forma más rápida de ver la app. Un servidor de prueba corre dentro del navegador.

```bash
npm install            # en la raíz, una sola vez
cd frontend
npm run dev:demo
```

Aparece un banner de "Modo demostración". Los datos viven solo en ese navegador.

### Opción B · Frontend + backend + PostgreSQL (desarrollo completo sin modo demo)

Consulta la **[`GUIA_DESARROLLO.md`](GUIA_DESARROLLO.md)** para la explicación detallada paso a paso.

1. **Base de datos.** Asegúrate de tener PostgreSQL corriendo localmente en el puerto 5432 o el configurado en `backend/.env`. Aplica roles y migraciones:
   ```bash
   npm run db:migrar --workspace backend
   npm run db:semilla --workspace backend
   ```

2. **API Backend**:
   ```bash
   cd backend
   npm run dev          # http://localhost:3000/api
   ```

3. **PWA Frontend** (conecta a la API real):
   ```bash
   cd frontend
   npm run dev          # http://localhost:5173 (NO dev:demo)
   ```

**Para empezar de cero en otro equipo:** crea los roles con `database/inicial/01_roles.sql` y copia `backend/.env.example` a `backend/.env`. Luego corre `npm run db:migrar` y `npm run db:semilla`. El detalle está en [`backend/README.md`](backend/README.md).

### Opción C · Docker (producción)

```bash
cp .env.example .env     # cambia TODAS las contraseñas y secretos
docker compose up -d --build
```

Levanta PostgreSQL (crea los roles en el primer arranque), la API (aplica migraciones al arrancar) y Caddy en los puertos 80 y 443. Si el equipo ya usa esos puertos (por ejemplo, Laragon), cambia `PUERTO_HTTP` y `PUERTO_HTTPS` en `.env`. Los negocios se crean con `POST /api/plataforma/negocios`; el ejemplo está en el README del backend.

Probado de punta a punta el 09/10/2026 a través de Caddy por HTTPS: PWA y API en el mismo origen, cookie Secure, alta de negocio, venta sincronizada sin duplicados, bajada incremental, reportes y tarea nocturna. La API se conecta como `mc_app` y `mc_plataforma`, nunca como superusuario.

### Usuarios de prueba

Funcionan en el modo demo y en la semilla de desarrollo. Contraseña: **`demo1234`**.

| Usuario | Rol | Qué puede hacer |
|---|---|---|
| `rodolfo` | Dueño | Todo. No se puede suspender ni cambiar de rol. |
| `ana` | Administrador | Todo, incluidas Revisiones, Usuarios y Reportes. |
| `carlos`, `luis` | Trabajador | Vender, cobrar, consultar inventario y agregar clientes. No cambia precios ni ve reportes. |

Negocio de prueba: "Bodega Hernández · Nave I", con 5 productos, 6 clientes, deudas vencidas y ventas del día.

---

## 4. Pruebas

| Dónde | Comando | Qué cubre |
|---|---|---|
| `frontend/` | `npm test` | Núcleo offline: folios por bloque, regla de stock, precio por rol, reenvíos, pagos con excedente, sesión, motor de sincronización y revisiones (13 pruebas). |
| `backend/` | `npm test` | API contra PostgreSQL real: login y límite de intentos compartido, RLS entre negocios, sincronización, bajada paginada, revisiones, conciliación, cancelaciones, ajustes, permisos y reportes (26 pruebas). Necesita el PostgreSQL de desarrollo encendido. |
| raíz | `npm test` / `npm run typecheck` | Las pruebas de ambos y los tipos de los tres paquetes. |

Las pruebas del backend borran y recrean la base `micentralmx_prueba` en cada corrida; no tocan la base de desarrollo.

---

## 5. Reglas del negocio y funcionamiento

**Trabajo sin conexión**
- La app guarda primero en el dispositivo (IndexedDB) y luego sincroniza: al abrir la app, al recuperar conexión, cada minuto si hay pendientes y con "Sincronizar ahora". No depende de Background Sync.
- Funcionan sin Internet: ventas, pagos de clientes, mermas, compras, alta de clientes e ingresos y egresos simples.
- Requieren conexión: productos y precios, ajustes de inventario, cancelaciones, usuarios, configuración, reportes, historial y revisiones.
- Guardar nunca falla por falta de red. Si algo falla es el almacenamiento del navegador.

**Folios.** Cada dispositivo reserva bloques de 100 folios definitivos cuando está en línea; un folio impreso nunca cambia. Si se acaban sin conexión, se usa uno provisional (`D3-P0001`) que el servidor reemplaza.

**Stock insuficiente**
- En línea se bloquea la venta, salvo para quien tenga permiso y escriba un motivo.
- Sin conexión solo se advierte. Si al sincronizar la existencia queda negativa, la venta se registra y queda en revisión.

**Precios y roles**
- Cambiar el precio en una venta y cambiar el precio de catálogo son permisos distintos; el Trabajador no tiene ninguno por omisión. Todo precio distinto al de catálogo queda en el historial.
- Roles base del negocio: Dueño, Administrador y Trabajador; el Administrador puede editar qué hace el Trabajador. El superadministrador es de plataforma y no aparece en la app.
- Los productos no se eliminan: se archivan y su historial se conserva.

**Sesión**
- El inicio de sesión requiere Internet.
- Sin conexión, la sesión sirve 24 h (configurable); después la app queda en solo lectura y conserva lo pendiente.
- No se puede cerrar sesión con operaciones pendientes, y solo hay un usuario por dispositivo sin conexión.

**Conciliación nocturna.** A las 03:00 (Ciudad de México), la API compara cada existencia contra la suma de sus movimientos; el historial manda. Si no coinciden, Dueño y Administrador ven un aviso en Inicio y en Inventario, y con "Corregir con el historial" igualan la existencia. Si el conteo físico es otro, después se registra un ajuste. Con varias instancias de la API, solo una la ejecuta. Si se prefiere un cron externo, se usa `npm run tareas:nocturnas` con `TAREAS_NOCTURNAS=false`.

**Bajada de datos.** Va por páginas de 1000 filas. Si se corta a mitad, el dispositivo la retoma sin perder ni repetir cambios. La primera bajada trae 30 días de operaciones más todas las deudas abiertas; lo anterior se consulta en línea.

**Revisiones.** Las operaciones que llegan con observaciones aparecen en Más → Revisiones para Dueño y Administrador. Ejemplos: existencia negativa, pago de más, reloj desfasado, cliente duplicado o un registro que todavía no existe. Desde ahí se **aprueban**, se **reaplican** o se **descartan**, con nota opcional.

**Carga del día y asignación (Fase 1)**
- Los orígenes se modelan en `proveedores` mediante el campo `tipo` (`'tercero'` o `'rancho_propio'`).
- Cada carga abierta registra la fruta que llega por clasificación y origen. Las ventas descuentan tanto de la carga asignada (`existencias_carga`) como del inventario general (`existencias`). Invariante: `existencias.cantidad = suma(existencias_carga) + existencia sin carga`.
- Asignación automática: la venta descuenta de la carga abierta más antigua con existencia disponible; si la cantidad excede la existencia de la carga seleccionada, el renglón se divide automáticamente entre varias cargas. El vendedor puede cambiar el origen asignado.
- Operación offline: registrar carga funciona sin conexión con idempotencia mediante la operación `'carga'`.
- Cierre de carga: requiere conexión y permiso `cargas.cerrar`; exige que todo sobrante se resuelva como merma, devolución al productor o se mantenga la carga abierta.
- Permisos: `cargas.registrar` y `cargas.cerrar` (el Trabajador no los tiene por omisión).
- Decimales en unidades: unidades como 'tara' permiten decimales (`permite_decimales = true`), configurables en línea.

**Liquidaciones a productores, comisiones y cuenta corriente (Fase 2 y Sprint 3)**
- **Consigna y ranchos propios:** La fruta de productores externos se vende en consigna y los ranchos propios no generan cuenta por pagar (`saldo = 0`).
- **Comisión flexible y mixta:** Puede ser porcentaje de lo vendido (`total_vendido × valor / 100`) o por unidad (`unidades_vendidas × valor`). Se define por omisión en el productor y puede sobrescribirse en la carga mientras no tenga renglones liquidados (`PATCH /cargas/:id/comision` exige `liquidaciones.gestionar`). Si varias cargas con comisiones distintas entran al mismo corte, se calcula por carga, se suma y se clasifica automáticamente como `'mixta'`, mostrándose en el estado de cuenta. Al emitir el corte, se valida que `0 <= comision_final <= total_vendido` y exige nota obligatoria si difiere de la calculada.
- **Cortes de cuenta (Liquidaciones) y bloqueo concurrente:** Inmutables una vez emitidos, con folio consecutivo propio (`#L-0001`). Exigen conexión a Internet. Al emitir un corte, el sistema bloquea con `FOR UPDATE` las ventas incluidas y vuelve a verificar dentro de la transacción que no estén canceladas ni cortadas por otra sesión simultánea.
- **Renglones de liquidación únicos:** Cada renglón de venta (`venta_id, linea`) entra a lo sumo en un corte (`UNIQUE (venta_id, linea)`). Solo entran renglones de ventas vigentes (no canceladas), de cargas de ese productor, no liquidados previamente.
- **Mermas cobradas por ID (`movimiento_id`):** Las mermas se descuentan asociando `movimiento_id` en `liquidacion_conceptos` con índice único parcial (`0010_liquidacion_merma.sql`). `GET /liquidaciones/pendientes` excluye mermas por `movimiento_id` en lugar de comparar texto, impidiendo que cambios de redacción reofrezcan mermas cobradas y rechazando dobles emisiones (409 conflicto).
- **Pagos y anticipos:** Se registran con `movimientos_dinero` (`egreso`, `pago_proveedor` y `anticipo_productor`). Pueden registrarse sin conexión y no se atan a ningún corte en específico. Se excluyen estrictamente de la cuenta de consigna los pagos ligados a compras (`compra_id IS NOT NULL` o concepto con `'compra'`).
- **Saldo del productor (derivado, nunca almacenado):** `saldo = sum(neto de liquidaciones) + abonos − cargos − pagos − anticipos`. Puede ser negativo si los anticipos superan lo liquidado (saldo a favor del comerciante).
- **Estado de cortes (FIFO unificado) y ajustes:**
  - Los pagos y anticipos se aplican cronológicamente por orden de antigüedad (FIFO) a los cortes para determinar su estado (`pendiente`, `parcial`, `pagado`).
  - Los cargos y abonos (`ajustes_productor`) ajustan el saldo global de la cuenta del productor, no el estado individual de cada corte.
- **Cancelaciones de ventas ya liquidadas:** Si se cancela una venta con renglones ya cortados, el sistema crea automáticamente un `ajustes_productor` de tipo `cargo` por `importe × (1 − tasa_efectiva)` (con `tasa_efectiva = comision_final / total_vendido`). La fruta devuelta siempre regresa a su carga y la reabre si estaba cerrada. Un productor con venta cortada y cancelada mantiene saldo cero tras el ajuste.
- **Ajustes manuales e incobrables:** Cargos y abonos manuales con asistente para cálculo sugerido de pérdida compartida por incobrables: `cargo = lo no cobrado × (1 − tasa de comisión)`.
- **Permisos:** `liquidaciones.ver` y `liquidaciones.gestionar` (asignados a Dueño y Administrador; el Trabajador no puede emitir cortes, modificar comisiones ni registrar ajustes).

**Seguridad**
- PostgreSQL aplica Row Level Security: aunque la API tuviera un error, un negocio no puede leer ni escribir datos de otro (está probado).
- La API se conecta con un rol sin privilegios para saltarse esa protección.
- Contraseñas con argon2. Sesión con token de 15 minutos más una cookie de renovación que solo viaja a `/api/auth` y se renueva en cada uso.
- Límite de 5 intentos de login por usuario e IP cada 15 minutos, guardado en la base: funciona igual con varias instancias. La IP y el usuario se guardan solo como hash.
- Los movimientos de inventario y la auditoría no se pueden editar ni borrar desde la API.

**Formatos.** Dinero en MXN (`$1,700`); fechas en DD/MM/AAAA, con hora de Ciudad de México.

**iPhone.** Hay que instalar la app en la pantalla de inicio. Si no, Safari puede borrar los datos guardados tras 7 días sin uso; la app lo avisa.

---

## 6. Archivos que no van al repositorio

| Archivo | Por qué |
|---|---|
| `backend/.env`, `backend/.env.test`, `.env` | Contraseñas y secretos. Se versionan solo los `.example`. |
| `node_modules/`, `dist/`, `frontend/dist-demo/` | Se generan con `npm install` y `npm run build`. |

Si se cambia el esquema de la base: **nueva migración** en `database/migraciones/` con el siguiente número (hoy van de `0001` a `0010_liquidacion_merma.sql`, la próxima es `0011_…sql`); nunca se edita una ya aplicada. Se aplica con `npm run db:migrar` en `backend/`. Si la tabla nueva es de un negocio, lleva `negocio_id`, RLS forzado con la política `aislamiento_negocio` y sus permisos para `mc_app`.

---

## 7. Pendientes conocidos

- Íconos PNG para iPhone (hoy solo hay ícono SVG).
- Pruebas de extremo a extremo automatizadas con Playwright.
- Dividir el paquete del frontend por rutas (809 KB, 239 KB comprimido).
