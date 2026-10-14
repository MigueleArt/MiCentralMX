import { describe, expect, it } from 'vitest';
import { errorNuevaContrasena } from '../auth/validarContrasena';

describe('HU-003 · restablecimiento administrativo de contraseña', () => {
  it('rechaza una contraseña menor a la política del MVP', () => {
    expect(errorNuevaContrasena('corta', 'corta')).toMatch(/8 caracteres/);
  });

  it('rechaza una confirmación diferente', () => {
    expect(errorNuevaContrasena('nueva-segura', 'otra-segura')).toMatch(/no coincide/);
  });

  it('acepta una contraseña válida confirmada', () => {
    expect(errorNuevaContrasena('nueva-segura', 'nueva-segura')).toBeNull();
  });
});

