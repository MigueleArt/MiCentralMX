/** Aviso desacoplado: el dominio registra una operación y el motor de sincronización la envía. */
const oyentes = new Set<() => void>();

export const alHaberOperacionNueva = (f: () => void) => {
  oyentes.add(f);
  return () => oyentes.delete(f);
};

export const avisarOperacionNueva = () => oyentes.forEach((f) => f());
