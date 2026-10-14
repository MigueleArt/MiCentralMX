Lezama Zarate Eduardo

# MiCentralMX

PWA para bodegas de la central de abasto: ventas de contado y a crédito, cobranza, inventario por clasificación (Primera, Segunda, Tercera…), compras, mermas, pagos y reportes. **Funciona sin conexión**: las operaciones se guardan en el dispositivo y se sincronizan una sola vez al recuperar Internet. Cada negocio tiene sus datos completamente separados.

| Documento | Para qué |
|---|---|
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

### Opción B · Frontend + backend + PostgreSQL (desarrollo completo)

1. **Base de datos.** En esta máquina ya existe un PostgreSQL de desarrollo en `C:\Users\eduar\AppData\Local\Temp\mcpg`, puerto **5433**, ya migrado y con datos de prueba. Para encenderlo:

   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D "C:\Users\eduar\AppData\Local\Temp\mcpg" -o "-p 5433" start
   ```

   Para apagarlo, el mismo comando con `stop`. Está en una carpeta temporal: si se borra, créalo de nuevo con los pasos de [`backend/README.md`](backend/README.md).

2. **API** (usa `backend/.env`, ya configurado para ese PostgreSQL):

   ```bash
   npm install          # en la raíz, si no lo has hecho
   cd backend
   npm run dev          # http://localhost:3000/api
   ```

3. **PWA** (Vite manda `/api` a `localhost:3000`):

   ```bash
   cd frontend
   npm run dev
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

Si se cambia el esquema de la base: **nueva migración** en `database/migraciones/` con el siguiente número (hoy van de `0001` a `0005`, la próxima es `0006_…sql`); nunca se edita una ya aplicada. Se aplica con `npm run db:migrar` en `backend/`. Si la tabla nueva es de un negocio, lleva `negocio_id`, RLS forzado con la política `aislamiento_negocio` y sus permisos para `mc_app`.

---

## 7. Pendientes conocidos

- Íconos PNG para iPhone (hoy solo hay ícono SVG).
- Pruebas de extremo a extremo automatizadas con Playwright.
- Dividir el paquete del frontend por rutas (809 KB, 239 KB comprimido).
