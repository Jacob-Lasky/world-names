import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// DO NOT change `base` without updating the Cloudflare Worker route in front of pietech.net.
// pietech.net/world-names/* is served by this app; the base prefix keeps asset URLs correct.
export default defineConfig({
  base: '/world-names/',
  plugins: [react()],
  server: {
    port: 5173,
    // sqlite-wasm needs SharedArrayBuffer → COOP/COEP cross-origin isolation headers in dev.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
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
