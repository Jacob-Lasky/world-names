import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// sqlite-wasm needs SharedArrayBuffer → COOP/COEP cross-origin isolation headers.
// Required in both dev and preview so locally-loaded data layers behave like prod.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// DO NOT change `base` without updating the Cloudflare Worker route in front of pietech.net.
// pietech.net/world-names/* is served by this app; the base prefix keeps asset URLs correct.
export default defineConfig({
  base: '/world-names/',
  plugins: [react()],
  server: { port: 5173, headers: crossOriginIsolationHeaders },
  preview: { headers: crossOriginIsolationHeaders },
  optimizeDeps: {
    // sqlite-wasm ships its own worker; don't try to pre-bundle it.
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
