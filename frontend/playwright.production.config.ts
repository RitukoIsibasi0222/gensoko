import { defineConfig, devices } from '@playwright/test';

import { loadProductionE2EConfig } from './e2e/production-config';

const productionConfig = loadProductionE2EConfig(process.env);

export default defineConfig({
  testDir: './e2e',
  testMatch: 'production-auth.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: true,
  reporter: 'list',
  outputDir: '.playwright-production-output',
  preserveOutput: 'never',
  use: {
    baseURL: productionConfig.baseUrl,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    ignoreHTTPSErrors: false
  },
  projects: [
    {
      name: 'production-chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
