function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) throw new Error(`Falta la variable de entorno ${nombre}`);
  return v;
}

export const config = {
  puerto: Number(process.env.PUERTO ?? 3000),
  databaseUrl: requerida('DATABASE_URL'),
  databasePlataformaUrl: process.env.DATABASE_PLATAFORMA_URL ?? null,
  jwtSecreto: requerida('JWT_SECRETO'),
  plataformaToken: process.env.PLATAFORMA_TOKEN ?? null,
  cookieSegura: process.env.COOKIE_SEGURA === 'true',
  /** Access token de corta duración (decisiones técnicas §4.3). */
  accessMinutos: 15,
  refreshDias: 30,
  /** Folios por bloque y tolerancia de reloj (decisiones técnicas §4.4). */
  tamanoBloqueFolios: 100,
  toleranciaRelojMs: 5 * 60_000,
  /** Retención de la primera bajada: 30 días más las deudas abiertas. */
  diasRetencion: 30,
  /** Filas por página de bajada (todas las tablas juntas). */
  tamanoPaginaBajada: Number(process.env.PAGINA_BAJADA ?? 1000),
  zonaHoraria: 'America/Mexico_City',
  versionesContrato: [1],
} as const;

if (config.jwtSecreto.length < 32) throw new Error('JWT_SECRETO debe tener al menos 32 caracteres');
