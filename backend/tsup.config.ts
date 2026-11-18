import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/servidor.ts', 'scripts/migrar.ts', 'scripts/nocturnas.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // El paquete compartido se publica como código TypeScript: se empaqueta; las demás dependencias quedan externas.
  noExternal: ['@micentralmx/shared'],
});
