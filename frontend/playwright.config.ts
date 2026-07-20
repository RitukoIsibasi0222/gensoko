import { defineConfig, devices } from '@playwright/test';

import { loadStagingE2EConfig } from './e2e/staging-config';

const stagingConfig = loadStagingE2EConfig(process.env);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  forbidOnly: true,
  reporter: 'list',
  outputDir: '.playwright-output',
  use: {
    baseURL: stagingConfig.baseUrl,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    ignoreHTTPSErrors: false
  },
  projects: [
    {
      name: 'staging-chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
