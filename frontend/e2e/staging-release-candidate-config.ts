import { validatePassword } from '../src/lib/validation/password';

export const M2_STAGING_FRONTEND_BASE_URL = 'https://gensoko-frontend-staging-develop.vercel.app';
export const M2_STAGING_API_BASE_URL = 'https://gensoko-api-staging.rituko-labs.workers.dev/api/v1';

const M2_SYNTHETIC_EMAIL = 'm2-release-candidate-user@example.test';
const INVALID_CONFIG_MESSAGE = 'M2 staging Playwright設定が不正です';

export type M2StagingE2EConfig = Readonly<{
  baseUrl: typeof M2_STAGING_FRONTEND_BASE_URL;
  apiBaseUrl: typeof M2_STAGING_API_BASE_URL;
  email: typeof M2_SYNTHETIC_EMAIL;
  password: string;
  vercelProtectionBypassSecret: string;
  crossSiteRefreshEvidence: 'protocol-only';
}>;

function requireExact<T extends string>(value: string | undefined, expected: T): T {
  if (value !== expected) {
    throw new Error(INVALID_CONFIG_MESSAGE);
  }
  return expected;
}

function requireCredential(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  if (validatePassword(normalized) !== null) {
    throw new Error(INVALID_CONFIG_MESSAGE);
  }
  return normalized;
}

function requireBypassSecret(value: string | undefined): string {
  if (!value || value !== value.trim() || /\s/.test(value)) {
    throw new Error(INVALID_CONFIG_MESSAGE);
  }
  return value;
}

export function loadM2StagingE2EConfig(
  environment: Readonly<Record<string, string | undefined>>
): M2StagingE2EConfig {
  try {
    return {
      baseUrl: requireExact(environment.M2_E2E_BASE_URL, M2_STAGING_FRONTEND_BASE_URL),
      apiBaseUrl: requireExact(environment.M2_E2E_API_BASE_URL, M2_STAGING_API_BASE_URL),
      email: requireExact(environment.M2_SYNTHETIC_EMAIL, M2_SYNTHETIC_EMAIL),
      password: requireCredential(environment.M2_SYNTHETIC_PASSWORD),
      vercelProtectionBypassSecret: requireBypassSecret(
        environment.VERCEL_AUTOMATION_BYPASS_SECRET
      ),
      crossSiteRefreshEvidence: 'protocol-only'
    };
  } catch {
    throw new Error(INVALID_CONFIG_MESSAGE);
  }
}
