import type { NegocioPlataforma, UsuarioPlataforma } from '@micentralmx/shared/api';

const CLAVE_STORAGE = 'mc_plataforma_token';

export function guardarTokenPlataforma(token: string) {
  sessionStorage.setItem(CLAVE_STORAGE, token);
  localStorage.setItem(CLAVE_STORAGE, token);
}

export function obtenerTokenPlataforma(): string | null {
  return sessionStorage.getItem(CLAVE_STORAGE) || localStorage.getItem(CLAVE_STORAGE);
}

export function limpiarTokenPlataforma() {
  sessionStorage.removeItem(CLAVE_STORAGE);
  localStorage.removeItem(CLAVE_STORAGE);
}

async function fetchPlataforma<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const token = obtenerTokenPlataforma();
  if (!token) {
    throw new Error('No hay sesión de Superadmin activa.');
  }

  const res = await fetch(`/api/plataforma${ruta}`, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      'X-Plataforma-Token': token,
      ...(opciones.headers || {}),
    },
  });

  const datos = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(datos.mensaje || datos.error || `Error ${res.status}: Falló la operación`);
  }

  return datos as T;
}

export async function verificarTokenPlataforma(token: string): Promise<boolean> {
  const res = await fetch('/api/plataforma/auth/verificar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Plataforma-Token': token,
    },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    return false;
  }

  const d = await res.json();
  return !!d.ok;
}

export async function obtenerNegociosPlataforma(): Promise<NegocioPlataforma[]> {
  return fetchPlataforma<NegocioPlataforma[]>('/negocios');
}

export async function obtenerDetalleNegocioPlataforma(id: string): Promise<NegocioPlataforma & { usuarios: UsuarioPlataforma[] }> {
  return fetchPlataforma<NegocioPlataforma & { usuarios: UsuarioPlataforma[] }>(`/negocios/${id}`);
}

export interface DatosNuevoNegocioPlataforma {
  nombre: string;
  ubicacion: string | null;
  telefono: string | null;
  dueno: {
    nombre: string;
    usuario: string;
    contrasena: string;
  };
}

export async function crearNegocioPlataforma(datos: DatosNuevoNegocioPlataforma): Promise<{ negocio_id: string; dueno_id: string }> {
  return fetchPlataforma<{ negocio_id: string; dueno_id: string }>('/negocios', {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export async function actualizarNegocioPlataforma(
  id: string,
  datos: {
    nombre?: string;
    telefono?: string | null;
    ubicacion?: string | null;
    ventanaOfflineHoras?: number;
    plazoCreditoDias?: number;
  },
) {
  return fetchPlataforma(`/negocios/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(datos),
  });
}

export async function obtenerUsuariosNegocioPlataforma(negocioId: string): Promise<UsuarioPlataforma[]> {
  return fetchPlataforma<UsuarioPlataforma[]>(`/negocios/${negocioId}/usuarios`);
}

export async function crearUsuarioNegocioPlataforma(
  negocioId: string,
  datos: {
    nombre: string;
    usuario: string;
    contrasena: string;
    rolBase: 'administrador' | 'trabajador' | 'dueno';
  },
) {
  return fetchPlataforma(`/negocios/${negocioId}/usuarios`, {
    method: 'POST',
    body: JSON.stringify(datos),
  });
}

export async function cambiarEstadoUsuarioPlataforma(usuarioId: string, activo: boolean) {
  return fetchPlataforma(`/usuarios/${usuarioId}/estado`, {
    method: 'PATCH',
    body: JSON.stringify({ activo }),
  });
}

export async function resetearClaveUsuarioPlataforma(usuarioId: string, contrasena: string) {
  return fetchPlataforma(`/usuarios/${usuarioId}/resetear-clave`, {
    method: 'POST',
    body: JSON.stringify({ contrasena }),
  });
}
