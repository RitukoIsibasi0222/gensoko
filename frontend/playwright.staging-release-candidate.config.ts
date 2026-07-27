import { defineConfig, devices } from '@playwright/test';

import { M2_STAGING_FRONTEND_BASE_URL } from './e2e/staging-release-candidate-config';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'staging-release-candidate.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  forbidOnly: true,
  reporter: 'list',
  outputDir: '.playwright-m2-output',
  use: {
    baseURL: M2_STAGING_FRONTEND_BASE_URL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    ignoreHTTPSErrors: false
  },
  projects: [
    {
      name: 'm2-staging-chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
