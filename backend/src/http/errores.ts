import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

/** Error con estado HTTP y mensaje legible para la UI ({ mensaje, codigo }). */
export class ErrorHttp extends Error {
  constructor(
    public readonly estado: number,
    mensaje: string,
    public readonly codigo?: string,
  ) {
    super(mensaje);
  }
}

export const noEncontrado = (m: string) => new ErrorHttp(404, m, 'no_encontrado');
export const conflicto = (m: string, codigo = 'conflicto') => new ErrorHttp(409, m, codigo);
export const invalido = (m: string, codigo = 'invalido') => new ErrorHttp(422, m, codigo);
export const prohibido = (m = 'Tu rol no permite esta acción.') => new ErrorHttp(403, m, 'sin_permiso');

/** Código de PostgreSQL de una violación de unicidad. */
export const esUnicidad = (e: unknown) => {
  const c = e as { code?: string; cause?: { code?: string } };
  return c?.code === '23505' || c?.cause?.code === '23505';
};

export const manejarErrores: ErrorRequestHandler = (e, _req, res, _next) => {
  if (e instanceof ErrorHttp) {
    res.status(e.estado).json({ mensaje: e.message, codigo: e.codigo });
    return;
  }
  if (e instanceof ZodError) {
    const primero = e.issues[0];
    res.status(422).json({ mensaje: `Dato inválido en ${primero?.path.join('.') || 'la solicitud'}: ${primero?.message}`, codigo: 'invalido' });
    return;
  }
  if ((e as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ mensaje: 'El cuerpo de la solicitud no es JSON válido.', codigo: 'json_invalido' });
    return;
  }
  console.error(e);
  res.status(500).json({ mensaje: 'Ocurrió un error en el servidor.', codigo: 'interno' });
};
