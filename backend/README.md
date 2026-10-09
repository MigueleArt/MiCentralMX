# MiCentralMX · API

API REST en Node.js 22, Express 5 y TypeScript, con PostgreSQL 18, Drizzle ORM, Zod, decimal.js y argon2. Implementa el contrato de `@micentralmx/shared` (`packages/shared`) y las reglas resumidas en la [sección 5 del README principal](../README.md#5-reglas-del-negocio-y-funcionamiento).

## Puesta en marcha local

1. **Roles y base de datos** (una vez, como superusuario de PostgreSQL):

   ```bash
   MC_OWNER_PASSWORD=… MC_APP_PASSWORD=… MC_PLATAFORMA_PASSWORD=… \
     psql -U postgres -d postgres -f database/inicial/01_roles.sql
   ```

2. Copia `.env.example` a `.env` y usa esas mismas contraseñas.
3. Instala y prepara:

   ```bash
   npm install           # en la raíz del repositorio (espacios de trabajo)
   npm run db:migrar     # aplica database/migraciones como mc_owner
   npm run db:semilla    # solo desarrollo: "Bodega Hernández" (rodolfo, ana, carlos, luis · demo1234)
   npm run dev           # http://localhost:3000/api
   npm run tareas:nocturnas   # conciliación y limpieza, una vez (para pruebas o cron externo)
   ```

   Variables opcionales: `TAREAS_NOCTURNAS=false` (no programar la tarea de las 03:00 dentro de la API) y `PAGINA_BAJADA` (filas por página de bajada; 1000 por omisión).

4. En `frontend/`, `npm run dev` ya manda `/api` a este servidor (proxy de Vite).

**Con Docker:** en la raíz, copia `.env.example` a `.env` y ejecuta `docker compose up -d --build`. Levanta PostgreSQL (crea los roles en el primer arranque), la API (migra al arrancar) y Caddy con HTTPS sirviendo la PWA y `/api` en el mismo origen. Para crear un negocio:

```bash
curl -X POST https://DOMINIO/api/plataforma/negocios -H "X-Plataforma-Token: $PLATAFORMA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Mi bodega","ubicacion":"Nave I","dueno":{"nombre":"…","usuario":"…","contrasena":"…"}}'
```

## Pruebas

`npm test` recrea la base desechable `micentralmx_prueba`, aplica migraciones, carga la semilla y prueba la API contra PostgreSQL real. Configúralo en `.env.test` (ver `.env.test.example`; necesita un usuario administrador para recrear la base). Las pruebas cubren:

- Login, límite de intentos (compartido entre dos instancias, sin IP en claro) y rotación del refresh token.
- RLS: sin negocio fijado no se ve nada, no se ven ni escriben filas de otro negocio, y la API devuelve 404 a otro negocio.
- Reenvío duplicado, mismo id con otro contenido, folio de otro dispositivo y folio provisional.
- Dos dispositivos vendiendo la misma mercancía, precio modificado por un Trabajador y reloj desfasado.
- Bajada incremental por cursor y paginada: páginas de 7 filas traen exactamente lo mismo que una sola página, sin repetidos; un cambio a mitad de la paginación llega en la siguiente sincronización; cursores mal formados se rechazan.
- Revisiones: dependencia faltante y reaplicación, excedente de pago y aprobación, permisos.
- Conciliación: detecta una existencia alterada, la corrige, cierra sola la alerta si ya cuadra, solo una instancia corre a la vez y la hora de las 03:00 se calcula bien.
- Cancelación con movimiento inverso, ajuste por conteo, alta y archivado de producto, usuario suspendido, reportes e historial.

## Seguridad

| Capa | Decisión |
|---|---|
| Base de datos | Tres roles: `mc_owner` (migraciones), `mc_app` (API, `NOBYPASSRLS`) y `mc_plataforma` (panel de plataforma). RLS **forzado** en todas las tablas operativas. Cada solicitud corre en una transacción con `set_config('app.negocio_id', …, true)`. |
| Login | El negocio aún no se conoce: dos funciones `SECURITY DEFINER` mínimas (`plataforma.buscar_login`, `plataforma.buscar_refresh`). |
| Sesión | Access token JWT de 15 min en memoria; refresh token opaco en cookie `httpOnly`, `SameSite=Strict`, `Path=/api/auth`, rotado en cada uso. En la base solo se guarda su SHA-256. |
| Permisos | Se revalidan en cada solicitud desde el rol vigente; la interfaz solo oculta. |
| Intentos de login | 5 fallos por usuario e IP cada 15 min, en la tabla `intentos_login` (vale con varias instancias). La clave es SHA-256 de IP y usuario. |
| Plataforma | `/api/plataforma` exige `X-Plataforma-Token` (comparación de tiempo constante) y usa el pool separado `mc_plataforma`. |
| Historial | `movimientos_inventario`, renglones, aplicaciones de pago y `auditoria` no tienen permiso de UPDATE ni DELETE para la API. |

## Estructura

```
src/
  auth/        Login, refresh, logout, contraseñas, tokens y límite de intentos
  db/          Pools (mc_app y mc_plataforma), conNegocio() y esquema Drizzle
  http/        Errores y envoltorio de rutas (token → transacción con RLS → permiso)
  lib/         Auditoría, existencias atómicas, dinero y mapeo a entidades del contrato
  modulos/
    sync/      /sync/push (operación por transacción, idempotente) y /sync/pull (bajada.ts, paginada)
    …          dispositivos y folios, catálogo, ventas, usuarios, consultas, revisiones, alertas, plataforma
  tareas/      Tarea nocturna (conciliación y limpieza de intentos de login)
scripts/       migrar.ts, semilla.ts y nocturnas.ts
test/          Pruebas de la API (Vitest + Supertest)
Dockerfile     Imagen de la API (contexto: la raíz del repositorio)
../database/   inicial/01_roles.sql y migraciones/*.sql (fuente de verdad del esquema y RLS)
../packages/shared/  Contrato compartido con la PWA

## Migraciones

| Archivo | Qué hace |
|---|---|
| `0001_esquema.sql` | Tablas, RLS forzado, cursor `xid8`, funciones de login y permisos de los roles. |
| `0002_permiso_revisiones.sql` | Da `revisiones.resolver` a Dueño y Administrador de negocios existentes. |
| `0003_intentos_login.sql` | Tabla del límite de intentos de login. |
| `0004_conciliacion_existencias.sql` | Tabla `alertas_inventario` y función `conciliar_existencias()`. |
| `0005_permisos_plataforma.sql` | Permisos de `mc_plataforma` para la tarea nocturna y tablas futuras. |
```

## Bajada paginada

`GET /sync/pull` devuelve como máximo `PAGINA_BAJADA` filas (todas las tablas juntas). Si no cabe todo, responde `hay_mas: true` y un cursor de continuación `p.<desde>.<hasta>.<tabla>.<últimoId>`. Ese cursor fija el rango de transacciones de la primera página, así que una bajada interrumpida se retoma sin perder ni repetir cambios. Lo que cambie mientras tanto llega en la siguiente sincronización. Al terminar, el cursor vuelve a ser un `xid8` simple.

## Conciliación nocturna

`conciliar_existencias()` (migración 0004) compara cada existencia con la suma de sus movimientos y abre una alerta por clasificación que no cuadre; cierra sola las que ya cuadran. La API la programa a las 03:00 de Ciudad de México con el pool `mc_plataforma`, protegida con un advisory lock para que con varias instancias corra solo una. Rutas: `GET /inventario/alertas`, `POST /inventario/conciliar` (solo el negocio propio) y `POST /inventario/alertas/:id/corregir` (iguala la existencia al historial y deja auditoría).

## Limitaciones conocidas

- La primera bajada trae 30 días de operaciones más las deudas abiertas (regla de retención local); lo anterior se consulta en línea (`GET /ventas/:id`).
- La semilla de desarrollo (`npm run db:semilla`) reutiliza los datos del modo demo de `frontend/src/demo/semilla.ts`; no se incluye en la imagen de Docker.
