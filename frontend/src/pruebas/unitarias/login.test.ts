import { describe, expect, it } from 'vitest';
import { validarLogin } from '../../auth/validarLogin';


describe('HU-001 · formulario de inicio de sesión', () => {
  it('indica ambos campos cuando están vacíos', () => {
    expect(validarLogin('  ', '')).toEqual({
      usuario: 'Escribe tu usuario o número de teléfono.',
      contrasena: 'Escribe tu contraseña.',
    });
  });

  it('indica solamente el campo que falta', () => {
    expect(validarLogin('ana', '')).toEqual({ contrasena: 'Escribe tu contraseña.' });
    expect(validarLogin('', 'secreto')).toEqual({ usuario: 'Escribe tu usuario o número de teléfono.' });
  });

  it('acepta usuario o teléfono junto con la contraseña', () => {
    expect(validarLogin('ana', 'secreto')).toEqual({});
    expect(validarLogin('55 1234 5678', 'secreto')).toEqual({});
  });
});

