import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import { rutasAuth } from './auth/rutas';
import { manejarErrores, noEncontrado } from './http/errores';
import { rutasAlertas } from './modulos/alertas';
import { rutasCatalogo } from './modulos/catalogo';
import { rutasConsultas } from './modulos/consultas';
import { rutasDispositivos } from './modulos/dispositivos';
import { rutasPlataforma } from './modulos/plataforma';
import { rutasRevisiones } from './modulos/revisiones';
import { rutasSync } from './modulos/sync/rutas';
import { rutasUsuarios } from './modulos/usuarios';
import { rutasVentas } from './modulos/ventas';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  // Detrás de Caddy: la IP real llega en X-Forwarded-For (limitación de intentos de login).
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  const api = Router();
  api.get('/salud', (_req, res) => {
    res.json({ ok: true });
  });
  api.use('/auth', rutasAuth);
  api.use('/plataforma', rutasPlataforma);
  api.use(rutasDispositivos, rutasSync, rutasCatalogo, rutasVentas, rutasUsuarios, rutasConsultas, rutasRevisiones, rutasAlertas);
  api.use((req, _res, next) => next(noEncontrado(`Ruta no disponible: ${req.method} ${req.path}`)));

  app.use('/api', api);
  app.use(manejarErrores);
  return app;
}
