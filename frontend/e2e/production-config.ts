import { isValidEmailFormat } from '../src/lib/validation/email';
import { validatePassword } from '../src/lib/validation/password';

export const PRODUCTION_E2E_CONFIG_ERROR_MESSAGE = 'production Playwright設定が不正です';

export type ProductionE2EConfig = Readonly<{
  baseUrl: string;
  apiBaseUrl: string;
  registrableDomain: string;
  email: string;
  password: string;
}>;

type ProductionE2EConfigOptions = Readonly<{
  allowReservedDomains?: boolean;
}>;

function failInvalidConfig(): never {
  throw new Error(PRODUCTION_E2E_CONFIG_ERROR_MESSAGE);
}

function parseExactHttpsUrl(value: string, expectedPath: string): URL {
  if (!value || value !== value.trim()) failInvalidConfig();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    failInvalidConfig();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== expectedPath ||
    url.search ||
    url.hash ||
    (expectedPath === '/' ? url.origin !== value : url.origin + expectedPath !== value)
  ) {
    failInvalidConfig();
  }
  return url;
}

export function belongsToSite(hostname: string, registrableDomain: string): boolean {
  return hostname === registrableDomain || hostname.endsWith('.' + registrableDomain);
}

function isValidDnsHostname(hostname: string): boolean {
  if (hostname.length > 253) return false;
  const labels = hostname.split('.');
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/.test(label)
    )
  );
}

function isProviderHostname(hostname: string): boolean {
  return ['workers.dev', 'vercel.app'].some(
    (provider) => hostname === provider || hostname.endsWith('.' + provider)
  );
}

function isReservedDomain(domain: string): boolean {
  return ['example.com', 'example.net', 'example.org', 'invalid', 'test', 'localhost'].some(
    (reserved) => domain === reserved || domain.endsWith('.' + reserved)
  );
}

export function validateProductionE2EConfig(
  input: ProductionE2EConfig,
  options: ProductionE2EConfigOptions = {}
): ProductionE2EConfig {
  try {
    const baseUrl = parseExactHttpsUrl(input.baseUrl, '/');
    const apiBaseUrl = parseExactHttpsUrl(input.apiBaseUrl, '/api/v1');
    const registrableDomain = input.registrableDomain;
    if (
      !registrableDomain ||
      registrableDomain !== registrableDomain.trim().toLowerCase() ||
      !isValidDnsHostname(registrableDomain) ||
      !isValidDnsHostname(baseUrl.hostname) ||
      !isValidDnsHostname(apiBaseUrl.hostname) ||
      baseUrl.hostname === apiBaseUrl.hostname ||
      !belongsToSite(baseUrl.hostname, registrableDomain) ||
      !belongsToSite(apiBaseUrl.hostname, registrableDomain) ||
      isProviderHostname(baseUrl.hostname) ||
      isProviderHostname(apiBaseUrl.hostname) ||
      (!options.allowReservedDomains && isReservedDomain(registrableDomain)) ||
      !input.email ||
      input.email !== input.email.trim() ||
      !isValidEmailFormat(input.email) ||
      input.password !== input.password.trim() ||
      validatePassword(input.password) !== null
    ) {
      failInvalidConfig();
    }
    return { ...input };
  } catch {
    failInvalidConfig();
  }
}

export function loadProductionE2EConfig(
  environment: Readonly<Record<string, string | undefined>>
): ProductionE2EConfig {
  return validateProductionE2EConfig({
    baseUrl: environment.PRODUCTION_E2E_BASE_URL ?? '',
    apiBaseUrl: environment.PRODUCTION_E2E_API_BASE_URL ?? '',
    registrableDomain: environment.PRODUCTION_REGISTRABLE_DOMAIN ?? '',
    email: environment.PRODUCTION_SMOKE_EMAIL ?? '',
    password: environment.PRODUCTION_SMOKE_PASSWORD ?? ''
  });
}
