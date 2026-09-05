import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@kidpc/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    /**
     * Localhost by default; `pnpm dev:tv` sets KIDPC_LAN=1 to bind every
     * interface so a TV on the same Wi-Fi can reach the dev server.
     *
     * Opt-in rather than always-on: a dev server bound to 0.0.0.0 is also a dev
     * server on café Wi-Fi, serving an app that mints session tokens.
     */
    host: process.env.KIDPC_LAN ? true : 'localhost',
    proxy: {
      // Same-origin in dev so the refresh cookie behaves exactly as it will in
      // production behind a single edge.
      '/v1': { target: 'http://127.0.0.1:4000', changeOrigin: true },
      '/stream': { target: 'ws://127.0.0.1:4000', ws: true },
    },
  },
});
