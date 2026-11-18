import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/preparar-base.ts'],
    setupFiles: ['test/entorno.ts'],
    // Comparten una sola base de prueba: los archivos corren en serie.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
