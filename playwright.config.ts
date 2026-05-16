import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Parallel workers contend on the shared Vite dev server's sqlite-wasm
  // initialization — multiple Chromium instances hitting the same wasm
  // module during init stall each other and tests time out waiting on
  // the SQLite-backed detail panel. 1 worker keeps the suite reliable
  // at the cost of ~30s end-to-end runtime, which is fine for our suite size.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173/world-names/',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/world-names/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
