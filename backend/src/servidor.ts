import { crearApp } from './app';
import { config } from './config';
import { cerrarPools } from './db/pool';
import { programarNocturnas } from './tareas/nocturnas';

const servidor = crearApp().listen(config.puerto, () => {
  console.log(`API de MiCentralMX en http://localhost:${config.puerto}/api`);
});

// Conciliación de existencias y limpieza a las 03:00 (desactivable si corre en un cron externo).
const detenerNocturnas = process.env.TAREAS_NOCTURNAS === 'false' ? () => {} : programarNocturnas();

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    detenerNocturnas();
    servidor.close(() => void cerrarPools().then(() => process.exit(0)));
  });
}
