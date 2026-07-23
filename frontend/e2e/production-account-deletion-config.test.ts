import { describe, expect, it } from 'vitest';

import {
  PRODUCTION_ACCOUNT_DELETION_E2E_CONFIG_ERROR_MESSAGE,
  loadProductionAccountDeletionE2EConfig
} from './production-account-deletion-config';

const ENVIRONMENT = {
  PRODUCTION_E2E_BASE_URL: 'https://app.gensoko.jp',
  PRODUCTION_E2E_API_BASE_URL: 'https://api.gensoko.jp/api/v1',
  PRODUCTION_REGISTRABLE_DOMAIN: 'gensoko.jp',
  PRODUCTION_ACCOUNT_DELETION_EMAIL: 'prod-delete-smoke+20260723@ops.gensoko.jp',
  PRODUCTION_ACCOUNT_DELETION_USERNAME: 'prod_delete_smoke',
  PRODUCTION_ACCOUNT_DELETION_PASSWORD: 'SyntheticDelete1!password',
  PRODUCTION_ACCOUNT_DELETION_CONFIRMATION: 'DELETE_PRODUCTION_SYNTHETIC_ACCOUNT'
} as const;

describe('production account deletion Playwright config guard', () => {
  it('同一siteのHTTPS targetと予約済みsynthetic identityだけを受理する', () => {
    expect(loadProductionAccountDeletionE2EConfig(ENVIRONMENT)).toEqual({
      baseUrl: ENVIRONMENT.PRODUCTION_E2E_BASE_URL,
      apiBaseUrl: ENVIRONMENT.PRODUCTION_E2E_API_BASE_URL,
      registrableDomain: ENVIRONMENT.PRODUCTION_REGISTRABLE_DOMAIN,
      email: ENVIRONMENT.PRODUCTION_ACCOUNT_DELETION_EMAIL,
      username: ENVIRONMENT.PRODUCTION_ACCOUNT_DELETION_USERNAME,
      password: ENVIRONMENT.PRODUCTION_ACCOUNT_DELETION_PASSWORD,
      confirmation: ENVIRONMENT.PRODUCTION_ACCOUNT_DELETION_CONFIRMATION
    });
  });

  it.each([
    { ...ENVIRONMENT, PRODUCTION_E2E_BASE_URL: 'http://app.gensoko.jp' },
    { ...ENVIRONMENT, PRODUCTION_E2E_BASE_URL: 'http://localhost:5174' },
    {
      ...ENVIRONMENT,
      PRODUCTION_E2E_BASE_URL: 'https://gensoko-frontend-staging-develop.vercel.app'
    },
    { ...ENVIRONMENT, PRODUCTION_E2E_API_BASE_URL: 'https://api.other.jp/api/v1' },
    { ...ENVIRONMENT, PRODUCTION_E2E_API_BASE_URL: 'https://api.gensoko.jp' },
    {
      ...ENVIRONMENT,
      PRODUCTION_E2E_API_BASE_URL: 'https://gensoko-api-staging.example.workers.dev/api/v1'
    }
  ])('localhost・HTTP・staging/provider・cross-site・不正API pathを拒否する', (environment) => {
    expect(() => loadProductionAccountDeletionE2EConfig(environment)).toThrow(
      PRODUCTION_ACCOUNT_DELETION_E2E_CONFIG_ERROR_MESSAGE
    );
  });

  it.each([
    { ...ENVIRONMENT, PRODUCTION_ACCOUNT_DELETION_USERNAME: 'normal_user' },
    { ...ENVIRONMENT, PRODUCTION_ACCOUNT_DELETION_USERNAME: ' prod_delete_smoke' },
    { ...ENVIRONMENT, PRODUCTION_ACCOUNT_DELETION_EMAIL: 'normal-user@ops.gensoko.jp' },
    { ...ENVIRONMENT, PRODUCTION_ACCOUNT_DELETION_EMAIL: 'prod-delete-smoke@outside.example' },
    { ...ENVIRONMENT, PRODUCTION_ACCOUNT_DELETION_EMAIL: 'prod-delete-smoke+@ops.gensoko.jp' },
    { ...ENVIRONMENT, PRODUCTION_ACCOUNT_DELETION_EMAIL: 'PROD-delete-smoke@ops.gensoko.jp' }
  ])('通常account・予約規則不一致・前後空白をlogin前に拒否する', (environment) => {
    expect(() => loadProductionAccountDeletionE2EConfig(environment)).toThrow(
      PRODUCTION_ACCOUNT_DELETION_E2E_CONFIG_ERROR_MESSAGE
    );
  });

  it.each([
    { ...ENVIRONMENT, PRODUCTION_ACCOUNT_DELETION_PASSWORD: '' },
    { ...ENVIRONMENT, PRODUCTION_ACCOUNT_DELETION_PASSWORD: 'weak-password' },
    { ...ENVIRONMENT, PRODUCTION_ACCOUNT_DELETION_PASSWORD: 'Aa1!' + 'a'.repeat(69) }
  ])('空・弱い・UTF-8で73byte以上のpasswordをrequest前に拒否する', (environment) => {
    expect(() => loadProductionAccountDeletionE2EConfig(environment)).toThrow(
      PRODUCTION_ACCOUNT_DELETION_E2E_CONFIG_ERROR_MESSAGE
    );
  });

  it.each([
    { ...ENVIRONMENT, PRODUCTION_ACCOUNT_DELETION_CONFIRMATION: '' },
    { ...ENVIRONMENT, PRODUCTION_ACCOUNT_DELETION_CONFIRMATION: 'DELETE_PRODUCTION_ACCOUNT' },
    {
      ...ENVIRONMENT,
      PRODUCTION_ACCOUNT_DELETION_CONFIRMATION: ' DELETE_PRODUCTION_SYNTHETIC_ACCOUNT'
    }
  ])('confirmationの未設定・不一致・前後空白を拒否する', (environment) => {
    expect(() => loadProductionAccountDeletionE2EConfig(environment)).toThrow(
      PRODUCTION_ACCOUNT_DELETION_E2E_CONFIG_ERROR_MESSAGE
    );
  });

  it('errorへidentity・password・confirmationを含めない', () => {
    const secretValues = [
      ENVIRONMENT.PRODUCTION_ACCOUNT_DELETION_EMAIL,
      ENVIRONMENT.PRODUCTION_ACCOUNT_DELETION_USERNAME,
      ENVIRONMENT.PRODUCTION_ACCOUNT_DELETION_PASSWORD,
      ENVIRONMENT.PRODUCTION_ACCOUNT_DELETION_CONFIRMATION,
      'normal_user'
    ];

    try {
      loadProductionAccountDeletionE2EConfig({
        ...ENVIRONMENT,
        PRODUCTION_ACCOUNT_DELETION_USERNAME: 'normal_user'
      });
      throw new Error('config guardが不正なidentityを受理しました');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : '';
      expect(message).toBe(PRODUCTION_ACCOUNT_DELETION_E2E_CONFIG_ERROR_MESSAGE);
      for (const secretValue of secretValues) {
        expect(message).not.toContain(secretValue);
      }
    }
  });
});
