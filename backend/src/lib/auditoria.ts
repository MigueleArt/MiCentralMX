import { v7 as uuid } from 'uuid';
import type { Tx } from '../db/pool';
import { auditoria } from '../db/esquema';

/** Registro de auditoría (propuesta §9): usuario, fecha, operación, registro y valores. */
export async function registrarAuditoria(
  tx: Tx,
  usuario: { id: string; negocioId: string; nombre: string },
  categoria: string,
  descripcion: string,
  extra: { tabla?: string; registroId?: string; antes?: unknown; despues?: unknown; fecha?: Date } = {},
) {
  await tx.insert(auditoria).values({
    id: uuid(),
    negocioId: usuario.negocioId,
    fecha: extra.fecha ?? new Date(),
    usuarioId: usuario.id,
    usuarioNombre: usuario.nombre,
    categoria,
    descripcion,
    tabla: extra.tabla ?? null,
    registroId: extra.registroId ?? null,
    valoresAnteriores: extra.antes ?? null,
    valoresNuevos: extra.despues ?? null,
  });
}
