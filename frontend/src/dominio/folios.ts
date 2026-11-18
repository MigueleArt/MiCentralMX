/**
 * Folios definitivos por bloques reservados (decisiones técnicas §2.1 y §4.4).
 * El dispositivo usa sus bloques sin conexión; el folio nunca cambia.
 * Solo si agota los bloques sin conexión usa un provisional D3-P0001 que el servidor renumera.
 */
import { CONFIG } from '../config';
import type { TipoFolio } from '@micentralmx/shared/api';
import { db } from '../db/db';

export interface FolioAsignado {
  folio: number | null;
  folioProvisional: string | null;
}

export async function reservarFolio(tipo: TipoFolio): Promise<FolioAsignado> {
  return db.transaction('rw', db.bloquesFolio, db.meta, async () => {
    const bloques = (await db.bloquesFolio.where('tipo').equals(tipo).toArray())
      .filter((b) => b.siguiente <= b.hasta)
      .sort((a, b) => a.desde - b.desde);
    const bloque = bloques[0];
    if (bloque) {
      await db.bloquesFolio.update(bloque.id, { siguiente: bloque.siguiente + 1 });
      return { folio: bloque.siguiente, folioProvisional: null };
    }
    const dispositivo = await db.leerMeta('dispositivo');
    if (!dispositivo) throw new Error('El dispositivo no está registrado.');
    const n = (dispositivo.provisionales[tipo] ?? 0) + 1;
    await db.guardarMeta('dispositivo', { ...dispositivo, provisionales: { ...dispositivo.provisionales, [tipo]: n } });
    return { folio: null, folioProvisional: `${dispositivo.codigo}-P${String(n).padStart(4, '0')}` };
  });
}

/** Folios que quedan en los bloques de un tipo. */
export async function foliosRestantes(tipo: TipoFolio): Promise<number> {
  const bloques = await db.bloquesFolio.where('tipo').equals(tipo).toArray();
  return bloques.reduce((n, b) => n + Math.max(0, b.hasta - b.siguiente + 1), 0);
}

export const necesitaBloque = async (tipo: TipoFolio) => (await foliosRestantes(tipo)) < CONFIG.umbralBloqueFolios;
