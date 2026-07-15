import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PRAX_E2E_PORT || '3199';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.js',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [['html'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Exercise the production SQLite repositories/routes, not a second in-memory
    // implementation that can drift from the shipped app.
    command: 'node server/index.js',
    env: { HOST: '127.0.0.1', PORT, PRAX_DB_FILE: ':memory:', EMBEDDING_BACKEND: 'none' },
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
