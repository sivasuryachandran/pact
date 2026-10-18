import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  resolve: { alias: { 'pact-signal': new URL('../src/index.ts', import.meta.url).pathname } },
  server: { port: 4173, strictPort: true },
});
