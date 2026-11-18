export interface ErroresLogin {
  usuario?: string;
  contrasena?: string;
}

/** Validaciones inmediatas del formulario; las credenciales siempre las decide el servidor. */
export function validarLogin(usuario: string, contrasena: string): ErroresLogin {
  return {
    ...(!usuario.trim() ? { usuario: 'Escribe tu usuario o número de teléfono.' } : {}),
    ...(!contrasena ? { contrasena: 'Escribe tu contraseña.' } : {}),
  };
}

