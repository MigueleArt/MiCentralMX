/**
 * Aplica database/migraciones/*.sql en orden, una vez cada una, como mc_owner.
 * Cada archivo corre en su propia transacción y queda registrado en esquema_migraciones.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export async function migrar(url: string, log = console.log): Promise<string[]> {
  // Desde scripts/ (tsx) o dist/scripts/ (compilado); en Docker se fija con MIGRACIONES_DIR.
  const dir =
    process.env.MIGRACIONES_DIR ??
    [join(import.meta.dirname, '..', '..', 'database', 'migraciones'), join(import.meta.dirname, '..', '..', '..', 'database', 'migraciones')].find((d) => existsSync(d));
  if (!dir) throw new Error('No encontré database/migraciones; define MIGRACIONES_DIR.');
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  const aplicadas: string[] = [];
  try {
    await cliente.query(`create table if not exists esquema_migraciones (
      archivo text primary key, aplicada_en timestamptz not null default now())`);
    const hechas = new Set((await cliente.query<{ archivo: string }>('select archivo from esquema_migraciones')).rows.map((r) => r.archivo));
    for (const archivo of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (hechas.has(archivo)) continue;
      await cliente.query('begin');
      try {
        await cliente.query(readFileSync(join(dir, archivo), 'utf8'));
        await cliente.query('insert into esquema_migraciones (archivo) values ($1)', [archivo]);
        await cliente.query('commit');
        aplicadas.push(archivo);
        log(`Aplicada ${archivo}`);
      } catch (e) {
        await cliente.query('rollback');
        throw new Error(`Falló ${archivo}: ${(e as Error).message}`);
      }
    }
    if (aplicadas.length === 0) log('La base ya está al día.');
    return aplicadas;
  } finally {
    await cliente.end();
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('Falta DATABASE_OWNER_URL');
  await migrar(url);
}
