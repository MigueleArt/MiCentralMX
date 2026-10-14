/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Modo demo (`vite --mode demo`): la app habla con un servidor de prueba que
// corre en el navegador (src/demo). Sin ese modo, todas las llamadas van a /api.
export default defineConfig(({ mode }) => ({
  define: {
    __MODO_DEMO__: JSON.stringify(mode === 'demo'),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // icono.svg ya entra por globPatterns; repetirlo (includeAssets o íconos del manifest) duplica la entrada y Workbox aborta la instalación.
      includeManifestIcons: false,
      manifest: {
        name: 'MiCentralMX',
        short_name: 'MiCentralMX',
        description: 'Ventas, inventario y cobranza para bodegas de la central de abasto.',
        lang: 'es-MX',
        start_url: '/',
        display: 'standalone',
        background_color: '#F7F8F6',
        theme_color: '#176B5B',
        icons: [{ src: 'icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'node',
    setupFiles: ['src/pruebas/preparacion.ts'],
  },
}));
