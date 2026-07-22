import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_E2E_CONFIG_ERROR_MESSAGE,
  validateProductionE2EConfig
} from './production-config';

const INPUT = {
  baseUrl: 'https://app.example.com',
  apiBaseUrl: 'https://api.example.com/api/v1',
  registrableDomain: 'example.com',
  email: 'smoke@example.com',
  password: 'SyntheticSmoke1!password'
} as const;

describe('production Playwright config guard', () => {
  it('同一siteのHTTPS frontend/APIとsynthetic credentialだけを受理する', () => {
    expect(validateProductionE2EConfig(INPUT, { allowReservedDomains: true })).toEqual(INPUT);
  });

  it.each([
    { ...INPUT, baseUrl: 'http://app.example.com' },
    { ...INPUT, baseUrl: 'https://app.example.com/path' },
    { ...INPUT, apiBaseUrl: 'https://api.example.net/api/v1' },
    { ...INPUT, apiBaseUrl: 'https://api.example.com' },
    { ...INPUT, baseUrl: 'https://app.vercel.app' },
    { ...INPUT, apiBaseUrl: 'https://api.workers.dev/api/v1' },
    { ...INPUT, baseUrl: 'https://user:pass@app.example.com' },
    { ...INPUT, password: 'short' }
  ])('不正target・URL・credentialを固定errorで拒否する', (input) => {
    expect(() => validateProductionE2EConfig(input, { allowReservedDomains: true })).toThrow(
      PRODUCTION_E2E_CONFIG_ERROR_MESSAGE
    );
  });

  it('通常実行では予約済みplaceholder domainを拒否する', () => {
    expect(() => validateProductionE2EConfig(INPUT)).toThrow(PRODUCTION_E2E_CONFIG_ERROR_MESSAGE);
  });

  it.each([
    { ...INPUT, baseUrl: 'https://app..example.com' },
    { ...INPUT, apiBaseUrl: 'https://-api.example.com/api/v1' },
    { ...INPUT, registrableDomain: '.example.com' },
    {
      ...INPUT,
      baseUrl: 'https://app.com',
      apiBaseUrl: 'https://api.com/api/v1',
      registrableDomain: 'com'
    }
  ])('DNS labelまたはregistrable domainとして不正なhostnameを拒否する', (input) => {
    expect(() => validateProductionE2EConfig(input, { allowReservedDomains: true })).toThrow(
      PRODUCTION_E2E_CONFIG_ERROR_MESSAGE
    );
  });
});
