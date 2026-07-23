import { defineConfig, devices } from '@playwright/test';

import { loadProductionAccountDeletionE2EConfig } from './e2e/production-account-deletion-config';

const productionConfig = loadProductionAccountDeletionE2EConfig(process.env);

export default defineConfig({
  testDir: './e2e',
  testMatch: 'production-account-deletion.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: true,
  reporter: 'list',
  outputDir: '.playwright-production-account-deletion-output',
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
      name: 'production-account-deletion-chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
