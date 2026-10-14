import type { RespuestaPull, RespuestaPush } from '@micentralmx/shared/api';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { config } from '../../config';
import { conNegocio } from '../../db/pool';
import * as t from '../../db/esquema';
import { ErrorHttp, esUnicidad, noEncontrado } from '../../http/errores';
import { asincrona, cargarUsuario, identidad, rutaNegocio } from '../../http/ruta';
import { aUsuarioSesion, negocioYConfiguracion } from '../../auth/rutas';
import { aplicarOperacion, type Resultado } from './aplicar';
import { bajarPagina } from './bajada';
import { esquemaPush, type OperacionEntrante } from './esquemas';

export const rutasSync = Router();

type ResultadoPush = RespuestaPush['resultados'][number];

/** Respuesta para una operación ya procesada: mismo resultado o rechazo si cambió el contenido. */
function respuestaGuardada(op: OperacionEntrante, previa: typeof t.operacionesSync.$inferSelect): ResultadoPush {
  if (previa.hash !== op.hash) return { operacion_id: op.operacion_id, estado: 'rechazada', motivo: 'La operación ya existe con otro contenido.' };
  return {
    operacion_id: op.operacion_id,
    estado: previa.estado === 'aplicada' ? 'duplicada' : previa.estado,
    motivo: previa.motivo,
    resultado: (previa.resultado as ResultadoPush['resultado']) ?? null,
  };
}

/**
 * POST /sync/push: cada operación en su propia transacción; un rechazo no bloquea la cola.
 * Idempotencia por (negocio_id, operacion_id) con el resultado original guardado.
 */
rutasSync.post(
  '/sync/push',
  asincrona(async (req) => {
    const { usuarioId, negocioId } = identidad(req);
    const s = esquemaPush.parse(req.body);
    if (!(config.versionesContrato as readonly number[]).includes(s.version_contrato)) {
      throw new ErrorHttp(409, 'Actualiza la aplicación para seguir sincronizando.', 'contrato_no_soportado');
    }
    // El usuario puede estar suspendido: se aceptan sus operaciones, pero quedan en revisión (§4.3).
    const autor = await conNegocio(negocioId, async (tx) => {
      const u = await cargarUsuario(tx, usuarioId);
      if (!u) throw new ErrorHttp(401, 'La sesión expiró.', 'sesion_expirada');
      const [d] = await tx.select({ id: t.dispositivos.id }).from(t.dispositivos).where(eq(t.dispositivos.id, s.dispositivo_id));
      if (!d) throw noEncontrado('El dispositivo no está registrado en este negocio.');
      return u;
    });

    const desfasado = Math.abs(new Date(s.reloj_dispositivo).getTime() - Date.now()) > config.toleranciaRelojMs;
    const general = [
      ...(desfasado ? ['La hora del dispositivo no era correcta.'] : []),
      ...(!autor.activo ? ['El usuario estaba suspendido.'] : []),
    ];

    const resultados: ResultadoPush[] = [];
    for (const op of s.operaciones) {
      if (op.usuario_id !== autor.id) {
        resultados.push({ operacion_id: op.operacion_id, estado: 'rechazada', motivo: 'La operación pertenece a otro usuario.' });
        continue;
      }
      try {
        resultados.push(
          await conNegocio(negocioId, async (tx) => {
            const [previa] = await tx
              .select()
              .from(t.operacionesSync)
              .where(eq(t.operacionesSync.operacionId, op.operacion_id));
            if (previa) return respuestaGuardada(op, previa);
            const r: Resultado = await aplicarOperacion(tx, op.tipo, op.datos, {
              autor,
              dispositivoId: s.dispositivo_id,
              creadoEnDispositivo: new Date(op.creado_en_dispositivo),
              revisionGeneral: general,
            });
            await tx.insert(t.operacionesSync).values({
              negocioId,
              operacionId: op.operacion_id,
              tipo: op.tipo,
              hash: op.hash,
              datos: op.datos as object,
              estado: r.estado,
              aplicada: r.aplicada,
              motivo: r.motivo,
              resultado: r.resultado,
              resumen: r.resumen,
              usuarioId: autor.id,
              dispositivoId: s.dispositivo_id,
              creadoEnDispositivo: new Date(op.creado_en_dispositivo),
            });
            return { operacion_id: op.operacion_id, estado: r.estado, motivo: r.motivo, resultado: r.resultado };
          }),
        );
      } catch (e) {
        // Dos envíos simultáneos de la misma operación: el segundo devuelve el resultado del primero.
        if (esUnicidad(e)) {
          const previa = await conNegocio(negocioId, (tx) =>
            tx.select().from(t.operacionesSync).where(eq(t.operacionesSync.operacionId, op.operacion_id)),
          );
          if (previa[0]) {
            resultados.push(respuestaGuardada(op, previa[0]));
            continue;
          }
        }
        // Falla inesperada: se detiene el lote; lo no contestado vuelve a la cola del dispositivo.
        console.error('Error al aplicar', op.operacion_id, e);
        break;
      }
    }
    await conNegocio(negocioId, (tx) => tx.update(t.usuarios).set({ ultimaActividad: new Date() }).where(eq(t.usuarios.id, autor.id)));
    return { reloj_servidor: new Date().toISOString(), resultados } satisfies RespuestaPush;
  }),
);

/** GET /sync/pull?cursor=…: una página de cambios; con hay_mas el cliente pide la siguiente (ver bajada.ts). */
rutasSync.get(
  '/sync/pull',
  rutaNegocio(null, async ({ tx, usuario, req }) => {
    const cursor = String(req.query.cursor ?? '0').slice(0, 120);
    const pagina = await bajarPagina(tx, cursor);
    const { configuracion } = await negocioYConfiguracion(tx, usuario.negocioId);
    return { cursor: pagina.cursor, hay_mas: pagina.hayMas, usuario: aUsuarioSesion(usuario), configuracion, cambios: pagina.cambios } satisfies RespuestaPull;
  }),
);
