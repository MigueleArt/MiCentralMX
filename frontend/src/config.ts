declare const __MODO_DEMO__: boolean;

/** Modo demostración: la API la responde un servidor de prueba dentro del navegador (src/demo). */
export const MODO_DEMO: boolean = typeof __MODO_DEMO__ !== 'undefined' && __MODO_DEMO__;

/** La PWA y la API comparten origen detrás de Caddy (decisiones técnicas §8). */
export const API_BASE = '/api';

/** Versión del contrato de sincronización que envía este cliente. */
export const VERSION_CONTRATO = 1;

export const CONFIG = {
  /** Horas que la sesión sigue válida sin contacto con el servidor (configurable por negocio). */
  ventanaOfflineHorasPredeterminada: 24,
  /** Folios definitivos que se reservan por bloque y umbral para pedir otro. */
  tamanoBloqueFolios: 100,
  umbralBloqueFolios: 20,
  /** Lote máximo de operaciones por push. */
  lotePush: 50,
  intervaloPushMs: 60_000,
  intervaloPullMs: 5 * 60_000,
  /** Diferencia de reloj tolerada contra el servidor. */
  toleranciaRelojMs: 5 * 60_000,
  /** Días de ventas, pagos y movimientos que se conservan en el dispositivo. */
  diasRetencion: 30,
  /** Una deuda es "próxima" si vence en estos días o menos. */
  diasDeudaProxima: 7,
  plazoCreditoPredeterminado: 7,
  zonaHoraria: 'America/Mexico_City',
} as const;
