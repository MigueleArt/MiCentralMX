import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { config } from '../config';
import * as esquema from './esquema';

// NUMERIC llega como texto (decimal.js en la app) y DATE como AAAA-MM-DD, sin zona horaria.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const poolApp = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
export const dbApp = drizzle(poolApp, { schema: esquema });

export type Tx = Parameters<Parameters<typeof dbApp.transaction>[0]>[0];
export type Db = NodePgDatabase<typeof esquema>;

/**
 * Toda solicitud del negocio corre en una transacción que fija el negocio con alcance LOCAL:
 * el valor no se queda en la conexión del pool (decisiones técnicas §4.1).
 */
export function conNegocio<T>(negocioId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return dbApp.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.negocio_id', ${negocioId}, true)`);
    return fn(tx);
  });
}

let poolPlataforma: pg.Pool | null = null;
/** Pool separado con mc_plataforma (BYPASSRLS), solo para /api/plataforma. */
export function dbPlataforma() {
  if (!config.databasePlataformaUrl) throw new Error('Falta DATABASE_PLATAFORMA_URL');
  poolPlataforma ??= new pg.Pool({ connectionString: config.databasePlataformaUrl, max: 2 });
  return drizzle(poolPlataforma, { schema: esquema });
}

export async function cerrarPools() {
  await poolApp.end();
  await poolPlataforma?.end();
}
