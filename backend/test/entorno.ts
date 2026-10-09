import { existsSync } from 'node:fs';

// Variables de la base de prueba (backend/.env.test, ver .env.test.example).
if (existsSync('.env.test')) process.loadEnvFile('.env.test');
