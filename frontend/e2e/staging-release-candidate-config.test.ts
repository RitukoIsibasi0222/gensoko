// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  M2_STAGING_API_BASE_URL,
  M2_STAGING_FRONTEND_BASE_URL,
  loadM2StagingE2EConfig
} from './staging-release-candidate-config';

const CONFIG_PATH = fileURLToPath(
  new URL('../playwright.staging-release-candidate.config.ts', import.meta.url)
);

const VALID_ENVIRONMENT = {
  M2_E2E_BASE_URL: M2_STAGING_FRONTEND_BASE_URL,
  M2_E2E_API_BASE_URL: M2_STAGING_API_BASE_URL,
  M2_SYNTHETIC_EMAIL: 'm2-release-candidate-user@example.test',
  M2_SYNTHETIC_PASSWORD: 'M2Synthetic1!password',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'secret-bypass'
};

describe('M2 staging Playwright config', () => {
  it('fixed staging originとprotocol-only refresh境界だけを受理する', () => {
    expect(loadM2StagingE2EConfig(VALID_ENVIRONMENT)).toMatchObject({
      baseUrl: M2_STAGING_FRONTEND_BASE_URL,
      apiBaseUrl: M2_STAGING_API_BASE_URL,
      crossSiteRefreshEvidence: 'protocol-only'
    });
    expect(() =>
      loadM2StagingE2EConfig({
        ...VALID_ENVIRONMENT,
        M2_E2E_BASE_URL: 'https://production.example.com'
      })
    ).toThrow('M2 staging Playwright設定が不正です');
  });

  it('1 worker・retry 0・attachment無効・list reporterへ固定する', () => {
    const source = readFileSync(CONFIG_PATH, 'utf8');

    expect(source).toContain("testMatch: 'staging-release-candidate.spec.ts'");
    expect(source).toContain('workers: 1');
    expect(source).toContain('retries: 0');
    expect(source).toContain("trace: 'off'");
    expect(source).toContain("screenshot: 'off'");
    expect(source).toContain("video: 'off'");
    expect(source).toContain("reporter: 'list'");
    expect(source).not.toContain('html');
  });
});
