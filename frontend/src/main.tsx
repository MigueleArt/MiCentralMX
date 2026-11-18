import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { ErrorApi } from './api/cliente';
import { restaurarSesion } from './auth/sesion';
import { SesionProvider } from './auth/SesionContext';
import { AvisosProvider } from './componentes/Avisos';
import { AvisosPwa } from './componentes/AvisosPwa';
import { router } from './rutas';
import './styles/tokens.css';
import './styles/componentes.css';
import './styles/layout.css';

// TanStack Query solo para pantallas en línea (decisiones técnicas §6); sin reintentos ante errores del servidor.
const consultas = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ErrorApi) && n < 2,
      staleTime: 30_000,
      networkMode: 'always',
    },
    mutations: { networkMode: 'always' },
  },
});

// Reduce el riesgo de que el navegador borre la base local (propuesta §7.3).
void navigator.storage?.persist?.();
void restaurarSesion();

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={consultas}>
      <SesionProvider>
        <AvisosProvider>
          <RouterProvider router={router} />
          <AvisosPwa />
        </AvisosProvider>
      </SesionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
