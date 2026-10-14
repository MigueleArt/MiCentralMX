/**
 * Motor de sincronización (decisiones técnicas §4.2).
 * Subida: lotes de hasta 50 operaciones en orden; cada una con su resultado.
 * Bajada: cambios desde el cursor hasta que el servidor indique que no hay más.
 * Se ejecuta al abrir la app, con el evento `online`, cada 60 s con pendientes,
 * cada 5 min para la bajada y con el botón "Sincronizar ahora". No usa Background Sync.
 */
import { useSyncExternalStore } from 'react';
import { api, ErrorApi, ErrorRed, hayToken, refrescarToken } from '../api/cliente';
import { CONFIG, VERSION_CONTRATO } from '../config';
import {
  esquemaRespuestaPull,
  esquemaRespuestaPush,
  type BloqueFolio,
  type OperacionPush,
  type RespuestaPull,
  type SolicitudPush,
  type TipoFolio,
} from '@micentralmx/shared/api';
import { db, type EstadoSync } from '../db/db';
import { necesitaBloque } from '../dominio/folios';
import { ahoraIso, diaLocal, sumarDias } from '../lib/fechas';
import { alHaberOperacionNueva } from './eventos';

export interface EstadoMotor {
  sincronizando: boolean;
  ultimoError: string | null;
}

let estado: EstadoMotor = { sincronizando: false, ultimoError: null };
const oyentes = new Set<() => void>();
const emitir = (parcial: Partial<EstadoMotor>) => {
  estado = { ...estado, ...parcial };
  oyentes.forEach((o) => o());
};
export const useEstadoMotor = () =>
  useSyncExternalStore(
    (o) => {
      oyentes.add(o);
      return () => oyentes.delete(o);
    },
    () => estado,
    () => estado,
  );

const ESTADO_POR_RESPUESTA: Record<string, EstadoSync> = {
  aplicada: 'sincronizada',
  duplicada: 'sincronizada',
  en_revision: 'en_revision',
  rechazada: 'rechazada',
};

/** Envía la cola. Devuelve false si el servidor no se alcanzó. */
async function subir(dispositivoId: string): Promise<boolean> {
  // Lo que quedó "enviando" por un cierre inesperado vuelve a la cola: el servidor lo deduplica.
  await db.operaciones.where('estado').equals('enviando').modify({ estado: 'pendiente' });
  for (;;) {
    const lote = await db.operaciones
      .where('estado')
      .equals('pendiente')
      .sortBy('creadoEnDispositivo')
      .then((ops) => ops.slice(0, CONFIG.lotePush));
    if (lote.length === 0) return true;

    const ids = lote.map((o) => o.operacionId);
    await db.operaciones.where('operacionId').anyOf(ids).modify((o) => {
      o.estado = 'enviando';
      o.intentos += 1;
    });
    const solicitud: SolicitudPush = {
      dispositivo_id: dispositivoId,
      reloj_dispositivo: ahoraIso(),
      version_contrato: VERSION_CONTRATO,
      operaciones: lote.map(
        (o): OperacionPush => ({
          operacion_id: o.operacionId,
          tipo: o.tipo,
          usuario_id: o.usuarioId,
          creado_en_dispositivo: o.creadoEnDispositivo,
          hash: o.hash,
          datos: o.datos,
        }),
      ),
    };

    let respuesta;
    try {
      respuesta = esquemaRespuestaPush.parse(await api('POST', '/sync/push', solicitud));
    } catch (e) {
      // Sin respuesta válida, todo el lote vuelve a la cola; el reintento es seguro por idempotencia.
      await db.operaciones.where('operacionId').anyOf(ids).modify({ estado: 'pendiente' });
      if (e instanceof ErrorRed) return false;
      throw e;
    }

    const desfase = Math.abs(new Date(respuesta.reloj_servidor).getTime() - Date.now());
    await db.guardarMeta('desfaseRelojMs', desfase);

    const respondidaEn = ahoraIso();
    await db.transaction('rw', db.operaciones, db.ventas, db.compras, async () => {
      for (const r of respuesta.resultados) {
        const op = await db.operaciones.get(r.operacion_id);
        if (!op) continue;
        await db.operaciones.update(op.operacionId, {
          estado: ESTADO_POR_RESPUESTA[r.estado],
          motivo: r.motivo ?? null,
          respondidaEn,
        });
        // Folio provisional: el servidor asigna el definitivo al sincronizar.
        const folio = r.resultado?.folio;
        if (folio != null && op.tipo === 'venta.crear') {
          await db.ventas.update(op.entidadId, { folio, folioProvisional: null });
        }
        if (folio != null && op.tipo === 'compra.crear') {
          await db.compras.update(op.entidadId, { folio, folioProvisional: null });
        }
      }
      // Lo que el servidor no contestó vuelve a la cola.
      const contestadas = new Set(respuesta.resultados.map((r) => r.operacion_id));
      for (const id of ids) {
        if (!contestadas.has(id)) await db.operaciones.update(id, { estado: 'pendiente' });
      }
    });
  }
}

/** Aplica la bajada al snapshot local. */
async function aplicarCambios(r: RespuestaPull) {
  const c = r.cambios;
  await db.transaction(
    'rw',
    [
      db.meta,
      db.unidades,
      db.productos,
      db.clasificaciones,
      db.existencias,
      db.clientes,
      db.proveedores,
      db.ventas,
      db.pagos,
      db.compras,
      db.movimientosInventario,
      db.movimientosDinero,
    ],
    async () => {
      await db.unidades.bulkPut(c.unidades);
      await db.productos.bulkPut(c.productos);
      await db.clasificaciones.bulkPut(c.clasificaciones);
      await db.existencias.bulkPut(c.existencias);
      await db.proveedores.bulkPut(c.proveedores);
      // Las versiones del servidor reemplazan a las locales (ya sincronizadas) con el mismo id.
      await db.clientes.bulkPut(c.clientes.map((x) => ({ ...x, operacionId: null })));
      await db.ventas.bulkPut(c.ventas.map((x) => ({ ...x, operacionId: null })));
      await db.pagos.bulkPut(c.pagos.map((x) => ({ ...x, operacionId: null })));
      await db.compras.bulkPut(c.compras.map((x) => ({ ...x, operacionId: null })));
      await db.movimientosInventario.bulkPut(c.movimientosInventario.map((x) => ({ ...x, operacionId: null })));
      await db.movimientosDinero.bulkPut(c.movimientosDinero.map((x) => ({ ...x, operacionId: null })));
      if (r.usuario || r.configuracion) {
        const sesion = await db.leerMeta('sesion');
        if (sesion) {
          await db.guardarMeta('sesion', {
            ...sesion,
            usuario: r.usuario ?? sesion.usuario,
            configuracion: r.configuracion ?? sesion.configuracion,
          });
        }
      }
      await db.guardarMeta('cursor', r.cursor);
    },
  );
}

/** Retención local: 30 días de ventas, pagos y movimientos, más las deudas abiertas completas. */
async function depurar() {
  const limite = sumarDias(diaLocal(), -CONFIG.diasRetencion);
  const viejo = (iso: string) => diaLocal(iso) < limite;
  const ops = new Map((await db.operaciones.toArray()).map((o) => [o.operacionId, o.estado]));
  const enCola = (id: string | null | undefined) => {
    const e = id ? ops.get(id) : undefined;
    return e === 'pendiente' || e === 'enviando';
  };
  await db.ventas
    .filter((v) => viejo(v.creadoEnDispositivo) && !enCola(v.operacionId) && !(v.formaPago === 'credito' && Number(v.total) > Number(v.pagado) && v.estado !== 'cancelada'))
    .delete();
  await db.pagos.filter((p) => viejo(p.creadoEnDispositivo) && !enCola(p.operacionId)).delete();
  await db.compras.filter((p) => viejo(p.creadoEnDispositivo) && !enCola(p.operacionId)).delete();
  await db.movimientosInventario.filter((m) => viejo(m.creadoEn) && !enCola(m.operacionId)).delete();
  await db.movimientosDinero.filter((m) => viejo(m.creadoEn) && !enCola(m.operacionId)).delete();
  await db.operaciones.filter((o) => o.estado === 'sincronizada' && viejo(o.creadoEnDispositivo)).delete();
}

async function bajar(): Promise<void> {
  const inicio = ahoraIso();
  let cursor = (await db.leerMeta('cursor')) ?? '0';
  for (;;) {
    const crudo = await api('GET', `/sync/pull?cursor=${encodeURIComponent(cursor)}`);
    const r = esquemaRespuestaPull.parse(crudo) as unknown as RespuestaPull;
    await aplicarCambios(r);
    cursor = r.cursor;
    if (!r.hay_mas) break;
  }
  // Desde aquí el snapshot ya incluye lo que el servidor respondió antes de `inicio`.
  await db.guardarMeta('ultimoPullInicio', inicio);
  await db.guardarMeta('ultimoPullFin', ahoraIso());
  await depurar();
}

async function reponerFolios(dispositivoId: string) {
  for (const tipo of ['venta', 'compra'] as TipoFolio[]) {
    if (await necesitaBloque(tipo)) {
      const b = await api<BloqueFolio>('POST', '/folios/bloques', { dispositivo_id: dispositivoId, tipo });
      await db.bloquesFolio.put({ ...b, siguiente: b.desde });
    }
  }
}

let enCurso: Promise<void> | null = null;
/** Alguien pidió sincronizar mientras otra corrida estaba en curso: se hace una vuelta más al terminar. */
let repetir = false;

/** Sincronización completa: subir, bajar y reponer folios. */
export function sincronizar(opciones: { soloSubir?: boolean } = {}): Promise<void> {
  if (enCurso) {
    repetir = true;
    return enCurso.then(() => (repetir ? sincronizar(opciones) : undefined));
  }
  repetir = false;
  enCurso = (async () => {
    try {
      const dispositivo = await db.leerMeta('dispositivo');
      const sesion = await db.leerMeta('sesion');
      if (!dispositivo || !sesion) return;
      emitir({ sincronizando: true, ultimoError: null });
      // Al reconectar, primero se renueva el token y después se envía la cola (§4.3).
      if (!hayToken() && !(await refrescarToken())) {
        emitir({ ultimoError: 'Tu sesión expiró. Vuelve a iniciar sesión para sincronizar.' });
        return;
      }
      const alcanzado = await subir(dispositivo.id);
      if (!alcanzado) return;
      if (!opciones.soloSubir) await bajar();
      await reponerFolios(dispositivo.id);
    } catch (e) {
      // Cualquier salida (incluida la anticipada sin dispositivo) libera el candado en finally.
      if (!(e instanceof ErrorRed)) {
        emitir({ ultimoError: e instanceof ErrorApi ? e.message : 'No se pudo completar la sincronización.' });
      }
    } finally {
      emitir({ sincronizando: false });
      enCurso = null;
    }
  })();
  return enCurso;
}

/** Arranca los disparadores automáticos. Devuelve la función para detenerlos. */
export function iniciarMotor(): () => void {
  const alAbrir = () => void sincronizar();
  const alConectar = () => void sincronizar();
  const intervaloPush = setInterval(async () => {
    const pendientes = await db.operaciones.where('estado').anyOf('pendiente', 'enviando').count();
    if (pendientes > 0 && navigator.onLine) void sincronizar({ soloSubir: true });
  }, CONFIG.intervaloPushMs);
  const intervaloPull = setInterval(() => navigator.onLine && void sincronizar(), CONFIG.intervaloPullMs);
  const quitarOyente = alHaberOperacionNueva(() => navigator.onLine && void sincronizar());
  window.addEventListener('online', alConectar);
  alAbrir();
  return () => {
    clearInterval(intervaloPush);
    clearInterval(intervaloPull);
    quitarOyente();
    window.removeEventListener('online', alConectar);
  };
}
