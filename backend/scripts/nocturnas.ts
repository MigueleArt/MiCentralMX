/** Ejecuta las tareas nocturnas una vez (para un cron externo o a mano). */
import { ejecutarNocturnas } from '../src/tareas/nocturnas';

const r = await ejecutarNocturnas(process.env.DATABASE_PLATAFORMA_URL);
console.log(
  r.ejecutada
    ? `Conciliación: ${r.alertasAbiertas} alertas abiertas, ${r.alertasCerradas} cerradas · ${r.intentosBorrados} intentos de login vencidos borrados.`
    : 'Otra instancia ya está ejecutando las tareas nocturnas.',
);
