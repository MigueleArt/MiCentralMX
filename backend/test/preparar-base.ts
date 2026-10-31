/**
 * Recrea la base de prueba en cada corrida: la borra, la crea con mc_owner como dueño,
 * aplica las migraciones y carga la semilla. Los roles mc_* ya deben existir en el clúster
 * (database/inicial/01_roles.sql).
 */
import { existsSync } from 'node:fs';
import pg from 'pg';

const BASE_PRUEBAS = 'micentralmx_prueba';
const VARIABLES_CI = [
  'TEST_ADMIN_URL',
  'DATABASE_URL',
  'DATABASE_PLATAFORMA_URL',
  'DATABASE_OWNER_URL',
  'JWT_SECRETO',
  'PLATAFORMA_TOKEN',
] as const;

export default async function preparar() {
  if (existsSync('.env.test')) process.loadEnvFile('.env.test');

  const esCI = process.env.CI === 'true';
  if (esCI && process.env.TEST_DB_OMITIR === 'true') {
    throw new Error('[backend/test] TEST_DB_OMITIR=true no está permitido en CI.');
  }
  if (esCI) {
    const faltantes = VARIABLES_CI.filter((nombre) => !process.env[nombre]);
    if (faltantes.length > 0) {
      throw new Error(`[backend/test] Faltan variables requeridas para CI: ${faltantes.join(', ')}`);
    }
  }

  const admin = process.env.TEST_ADMIN_URL;
  const owner = process.env.DATABASE_OWNER_URL;
  if (!admin || !owner) {
    console.warn('\n⚠️ [backend/test] Sin base de datos configurada (falta backend/.env.test). Pruebas de PostgreSQL omitidas.');
    process.env.TEST_DB_OMITIR = 'true';
    return;
  }

  try {
    const nombre = new URL(owner).pathname.slice(1);
    if (nombre !== BASE_PRUEBAS) {
      throw new Error(`[backend/test] Base rechazada por seguridad: solo se permite ${BASE_PRUEBAS}.`);
    }

    const c = new pg.Client({ connectionString: admin });
    await c.connect();
    await c.query(`drop database if exists ${BASE_PRUEBAS} with (force)`);
    await c.query(`create database ${BASE_PRUEBAS} owner mc_owner`);
    await c.end();

    const db = new pg.Client({ connectionString: admin.replace(/\/[^/]*$/, `/${nombre}`) });
    await db.connect();
    await db.query('alter schema public owner to mc_owner; revoke all on schema public from public; grant usage on schema public to mc_app, mc_plataforma');
    await db.end();

    // Importación diferida: estos módulos leen la configuración al cargarse.
    const { migrar } = await import('../scripts/migrar');
    const { sembrar } = await import('../scripts/semilla');
    await migrar(owner, () => {});
    await sembrar(owner);
  } catch (err) {
    const detalle = err instanceof Error ? err.message : 'Error desconocido';
    if (esCI) {
      throw new Error(`[backend/test] No se pudo preparar la base de pruebas en CI: ${detalle}`);
    }
    console.warn('\n⚠️ [backend/test] No se pudo conectar a PostgreSQL para preparar la base de prueba:', detalle);
    process.env.TEST_DB_OMITIR = 'true';
  }
}
