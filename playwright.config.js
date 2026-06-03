import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.MOOMORA_E2E_PORT || '3199';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.js',
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
    command: 'node scripts/demo-server.js',
    env: { HOST: '127.0.0.1', PORT },
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
