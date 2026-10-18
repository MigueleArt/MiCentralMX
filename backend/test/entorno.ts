import { existsSync } from 'node:fs';

// Variables de la base de prueba (backend/.env.test, ver .env.test.example).
if (existsSync('.env.test')) {
  process.loadEnvFile('.env.test');
} else {
  process.env.DATABASE_URL ??= 'postgres://dummy:dummy@localhost:5432/dummy';
  process.env.JWT_SECRETO ??= 'secreto-de-pruebas-0123456789abcdefghijklmnop';
  process.env.DATABASE_OWNER_URL ??= 'postgres://dummy:dummy@localhost:5432/dummy';
  process.env.TEST_DB_OMITIR = 'true';
}
