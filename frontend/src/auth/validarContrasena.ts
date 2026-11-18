/** Política mínima del MVP y confirmación usada por los flujos de contraseña. */
export function errorNuevaContrasena(nueva: string, confirmacion: string): string | null {
  if (nueva.length < 8) return 'La nueva contraseña debe tener al menos 8 caracteres.';
  if (nueva !== confirmacion) return 'La confirmación no coincide con la nueva contraseña.';
  return null;
}

