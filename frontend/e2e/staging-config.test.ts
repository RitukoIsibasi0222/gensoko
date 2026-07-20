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
  STAGING_SYNTHETIC_USER_PASSWORD: 'SyntheticUser1!password',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'vercel-automation-bypass-test-secret'
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
      userPassword: VALID_ENVIRONMENT.STAGING_SYNTHETIC_USER_PASSWORD,
      vercelProtectionBypassSecret: VALID_ENVIRONMENT.VERCEL_AUTOMATION_BYPASS_SECRET
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
    'STAGING_SYNTHETIC_USER_PASSWORD',
    'VERCEL_AUTOMATION_BYPASS_SECRET'
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

  it('Adminと対象Userの同一passwordを拒否する', () => {
    expect(() =>
      loadStagingE2EConfig({
        ...VALID_ENVIRONMENT,
        STAGING_SYNTHETIC_USER_PASSWORD: VALID_ENVIRONMENT.STAGING_SYNTHETIC_ADMIN_PASSWORD
      })
    ).toThrow('staging Playwright設定が不正です');
  });

  it('passwordの先頭末尾空白をbackendと同じく正規化して返す', () => {
    const config = loadStagingE2EConfig({
      ...VALID_ENVIRONMENT,
      STAGING_SYNTHETIC_ADMIN_PASSWORD: `  ${VALID_ENVIRONMENT.STAGING_SYNTHETIC_ADMIN_PASSWORD}  `,
      STAGING_SYNTHETIC_USER_PASSWORD: `  ${VALID_ENVIRONMENT.STAGING_SYNTHETIC_USER_PASSWORD}  `
    });

    expect(config.adminPassword).toBe(VALID_ENVIRONMENT.STAGING_SYNTHETIC_ADMIN_PASSWORD);
    expect(config.userPassword).toBe(VALID_ENVIRONMENT.STAGING_SYNTHETIC_USER_PASSWORD);
  });

  it('正規化後に同一になるAdminと対象Userのpasswordを拒否する', () => {
    expect(() =>
      loadStagingE2EConfig({
        ...VALID_ENVIRONMENT,
        STAGING_SYNTHETIC_ADMIN_PASSWORD: `  ${VALID_ENVIRONMENT.STAGING_SYNTHETIC_ADMIN_PASSWORD}`,
        STAGING_SYNTHETIC_USER_PASSWORD: `${VALID_ENVIRONMENT.STAGING_SYNTHETIC_ADMIN_PASSWORD}  `
      })
    ).toThrow('staging Playwright設定が不正です');
  });

  it.each([
    ['8文字未満', 'Aa1!abc'],
    ['内部スペース', 'Synthetic Admin1!password'],
    ['bcrypt上限超過', `Aa1!${'a'.repeat(69)}`]
  ])('%sのpasswordをbackendへ到達する前に拒否する', (_label, password) => {
    expect(() =>
      loadStagingE2EConfig({
        ...VALID_ENVIRONMENT,
        STAGING_SYNTHETIC_ADMIN_PASSWORD: password
      })
    ).toThrow('staging Playwright設定が不正です');
  });

  it.each(['STAGING_SYNTHETIC_ADMIN_PASSWORD', 'STAGING_SYNTHETIC_USER_PASSWORD'] as const)(
    '%sの空白のみの値を拒否する',
    (name) => {
      expect(() => loadStagingE2EConfig({ ...VALID_ENVIRONMENT, [name]: '   ' })).toThrow(
        'staging Playwright設定が不正です'
      );
    }
  );

  it.each([
    ['STAGING_SYNTHETIC_ADMIN_EMAIL', 'staging-synthetic-e2e-admin+other@example.test'],
    ['STAGING_SYNTHETIC_USER_USERNAME', 'staging_synthetic_e2e_user_other'],
    ['STAGING_SYNTHETIC_USER_EMAIL', 'staging-synthetic-e2e-user+other@example.test']
  ] as const)('%sの近似識別子を拒否する', (name, value) => {
    expect(() => loadStagingE2EConfig({ ...VALID_ENVIRONMENT, [name]: value })).toThrow(
      'staging Playwright設定が不正です'
    );
  });

  it.each(['   ', ' bypass-secret', 'bypass-secret ', 'bypass secret'])(
    'Vercel automation bypass Secretの空白・前後空白を拒否する',
    (value) => {
      expect(() =>
        loadStagingE2EConfig({
          ...VALID_ENVIRONMENT,
          VERCEL_AUTOMATION_BYPASS_SECRET: value
        })
      ).toThrow('staging Playwright設定が不正です');
    }
  );
});
