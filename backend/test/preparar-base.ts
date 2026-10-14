/**
 * Recrea la base de prueba en cada corrida: la borra, la crea con mc_owner como dueño,
 * aplica las migraciones y carga la semilla. Los roles mc_* ya deben existir en el clúster
 * (database/inicial/01_roles.sql).
 */
import { existsSync } from 'node:fs';
import pg from 'pg';

export default async function preparar() {
  if (existsSync('.env.test')) process.loadEnvFile('.env.test');
  const admin = process.env.TEST_ADMIN_URL;
  const owner = process.env.DATABASE_OWNER_URL;
  if (!admin || !owner) throw new Error('Configura backend/.env.test (ver .env.test.example)');
  const nombre = new URL(owner).pathname.slice(1);

  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`drop database if exists ${nombre} with (force)`);
  await c.query(`create database ${nombre} owner mc_owner`);
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
}
