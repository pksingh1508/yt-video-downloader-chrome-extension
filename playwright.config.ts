import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run test:companion',
    url: 'http://127.0.0.1:3002/api/health',
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
