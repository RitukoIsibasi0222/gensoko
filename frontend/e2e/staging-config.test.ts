import { describe, expect, it } from 'vitest';

import {
  STAGING_API_BASE_URL,
  STAGING_FRONTEND_BASE_URL,
  loadStagingE2EConfig
} from './staging-config';

const VALID_ENVIRONMENT = {
  STAGING_E2E_BASE_URL: 'https://gensoko-frontend-staging-develop.vercel.app',
  STAGING_E2E_API_BASE_URL: 'https://gensoko-api-staging.rituko-labs.workers.dev/api/v1',
  STAGING_SYNTHETIC_ADMIN_EMAIL: 'staging-synthetic-e2e-admin@example.test',
  STAGING_SYNTHETIC_ADMIN_PASSWORD: 'SyntheticAdmin1!password',
  STAGING_SYNTHETIC_USER_USERNAME: 'staging_synthetic_e2e_user',
  STAGING_SYNTHETIC_USER_EMAIL: 'staging-synthetic-e2e-user@example.test',
  STAGING_SYNTHETIC_USER_PASSWORD: 'SyntheticUser1!password'
} as const;

describe('staging Playwright config guard', () => {
  it('固定staging Vercel/API URLとsynthetic credentialだけを受理する', () => {
    expect(loadStagingE2EConfig(VALID_ENVIRONMENT)).toEqual({
      baseUrl: STAGING_FRONTEND_BASE_URL,
      apiBaseUrl: STAGING_API_BASE_URL,
      adminEmail: VALID_ENVIRONMENT.STAGING_SYNTHETIC_ADMIN_EMAIL,
      adminPassword: VALID_ENVIRONMENT.STAGING_SYNTHETIC_ADMIN_PASSWORD,
      userUsername: VALID_ENVIRONMENT.STAGING_SYNTHETIC_USER_USERNAME,
      userEmail: VALID_ENVIRONMENT.STAGING_SYNTHETIC_USER_EMAIL,
      userPassword: VALID_ENVIRONMENT.STAGING_SYNTHETIC_USER_PASSWORD
    });
  });

  it.each([
    ['STAGING_E2E_BASE_URL', 'https://gensoko.example.com'],
    ['STAGING_E2E_BASE_URL', 'https://example.vercel.app'],
    ['STAGING_E2E_API_BASE_URL', 'https://api.gensoko.example.com/api/v1'],
    ['STAGING_E2E_API_BASE_URL', 'https://example.workers.dev/api/v1']
  ] as const)('%sのproduction・任意URLを拒否する', (name, value) => {
    expect(() => loadStagingE2EConfig({ ...VALID_ENVIRONMENT, [name]: value })).toThrow(
      'staging Playwright設定が不正です'
    );
  });

  it.each([
    'STAGING_SYNTHETIC_ADMIN_EMAIL',
    'STAGING_SYNTHETIC_ADMIN_PASSWORD',
    'STAGING_SYNTHETIC_USER_USERNAME',
    'STAGING_SYNTHETIC_USER_EMAIL',
    'STAGING_SYNTHETIC_USER_PASSWORD'
  ] as const)('%sの欠落をcredential値を含まない固定errorで拒否する', (name) => {
    const secret = VALID_ENVIRONMENT[name];
    expect(() => loadStagingE2EConfig({ ...VALID_ENVIRONMENT, [name]: '' })).toThrow(
      'staging Playwright設定が不正です'
    );

    try {
      loadStagingE2EConfig({ ...VALID_ENVIRONMENT, [name]: '' });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
