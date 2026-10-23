import { describe, expect, it } from 'vitest';
import { determinarEstadoSync } from '../../hooks/useResumenSync';


const base = {
  enLinea: true,
  sincronizando: false,
  horaIncorrecta: false,
  porRevisar: 0,
  pendientes: 0,
  error: null,
};

describe('HU-125 · estado general de sincronización', () => {
  it('muestra actualizado solo con conexión y sin cambios pendientes', () => {
    expect(determinarEstadoSync(base)).toBe('actualizado');
    expect(determinarEstadoSync({ ...base, enLinea: false })).toBe('sin_conexion');
  });

  it('informa cuando existen operaciones pendientes', () => {
    expect(determinarEstadoSync({ ...base, pendientes: 2 })).toBe('pendientes');
  });

  it('prioriza falta de conexión sobre un estado aparentemente actualizado', () => {
    expect(determinarEstadoSync({ ...base, enLinea: false, pendientes: 3 })).toBe('sin_conexion');
  });

  it('informa sincronización activa, revisiones y errores', () => {
    expect(determinarEstadoSync({ ...base, sincronizando: true })).toBe('sincronizando');
    expect(determinarEstadoSync({ ...base, porRevisar: 1 })).toBe('por_revisar');
    expect(determinarEstadoSync({ ...base, error: 'falló' })).toBe('error');
  });
});
