import { afterEach, describe, expect, it, vi } from 'vitest';
import { haceCuanto } from '../lib/fechas';

describe('HU-109 · actividad reciente de usuarios', () => {
  afterEach(() => vi.useRealTimers());

  it('muestra actividad actual y minutos transcurridos', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T18:00:00.000Z'));

    expect(haceCuanto('2026-10-14T17:59:00.000Z')).toBe('ahora');
    expect(haceCuanto('2026-10-14T17:50:00.000Z')).toBe('hace 10 min');
  });

  it('muestra ayer para una actividad del día anterior', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T18:00:00.000Z'));

    expect(haceCuanto('2026-10-13T18:00:00.000Z')).toBe('ayer');
  });
});

