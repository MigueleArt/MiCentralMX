import { existsSync } from 'node:fs';

const esCI = process.env.CI === 'true';
const existeEnvTest = existsSync('.env.test');

// Variables de la base de prueba (backend/.env.test, ver .env.test.example).
if (existeEnvTest) {
  process.loadEnvFile('.env.test');
}

if (esCI) {
  if (process.env.TEST_DB_OMITIR === 'true') {
    throw new Error('[backend/test] Las pruebas de PostgreSQL no pueden omitirse en CI.');
  }

  const requeridas = [
    'TEST_ADMIN_URL',
    'DATABASE_URL',
    'DATABASE_PLATAFORMA_URL',
    'DATABASE_OWNER_URL',
    'JWT_SECRETO',
    'PLATAFORMA_TOKEN',
  ] as const;
  const faltantes = requeridas.filter((nombre) => !process.env[nombre]);
  if (faltantes.length > 0) {
    throw new Error(`[backend/test] Configuración incompleta para CI: ${faltantes.join(', ')}`);
  }
} else if (!existeEnvTest) {
  process.env.DATABASE_URL ??= 'postgres://dummy:dummy@localhost:5432/dummy';
  process.env.JWT_SECRETO ??= 'secreto-de-pruebas-0123456789abcdefghijklmnop';
  process.env.DATABASE_OWNER_URL ??= 'postgres://dummy:dummy@localhost:5432/dummy';
  process.env.TEST_DB_OMITIR = 'true';
}
