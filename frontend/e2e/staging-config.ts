export const STAGING_FRONTEND_BASE_URL = 'https://gensoko-frontend-staging-develop.vercel.app';
export const STAGING_API_BASE_URL = 'https://gensoko-api-staging.rituko-labs.workers.dev/api/v1';

const STAGING_SYNTHETIC_ADMIN_EMAIL = 'staging-synthetic-e2e-admin@example.test';
const STAGING_SYNTHETIC_USER_USERNAME = 'staging_synthetic_e2e_user';
const STAGING_SYNTHETIC_USER_EMAIL = 'staging-synthetic-e2e-user@example.test';
const INVALID_CONFIG_MESSAGE = 'staging Playwright設定が不正です';

export type StagingE2EConfig = Readonly<{
  baseUrl: typeof STAGING_FRONTEND_BASE_URL;
  apiBaseUrl: typeof STAGING_API_BASE_URL;
  adminEmail: typeof STAGING_SYNTHETIC_ADMIN_EMAIL;
  adminPassword: string;
  userUsername: typeof STAGING_SYNTHETIC_USER_USERNAME;
  userEmail: typeof STAGING_SYNTHETIC_USER_EMAIL;
  userPassword: string;
}>;

function requireExactValue<T extends string>(value: string | undefined, expected: T): T {
  if (value !== expected) {
    throw new Error(INVALID_CONFIG_MESSAGE);
  }
  return expected;
}

function requireCredential(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(INVALID_CONFIG_MESSAGE);
  }
  return value;
}

export function loadStagingE2EConfig(
  environment: Readonly<Record<string, string | undefined>>
): StagingE2EConfig {
  try {
    const baseUrl = requireExactValue(environment.STAGING_E2E_BASE_URL, STAGING_FRONTEND_BASE_URL);
    const apiBaseUrl = requireExactValue(
      environment.STAGING_E2E_API_BASE_URL,
      STAGING_API_BASE_URL
    );
    const adminEmail = requireExactValue(
      environment.STAGING_SYNTHETIC_ADMIN_EMAIL,
      STAGING_SYNTHETIC_ADMIN_EMAIL
    );
    const userUsername = requireExactValue(
      environment.STAGING_SYNTHETIC_USER_USERNAME,
      STAGING_SYNTHETIC_USER_USERNAME
    );
    const userEmail = requireExactValue(
      environment.STAGING_SYNTHETIC_USER_EMAIL,
      STAGING_SYNTHETIC_USER_EMAIL
    );
    const adminPassword = requireCredential(environment.STAGING_SYNTHETIC_ADMIN_PASSWORD);
    const userPassword = requireCredential(environment.STAGING_SYNTHETIC_USER_PASSWORD);
    if (adminPassword === userPassword) {
      throw new Error(INVALID_CONFIG_MESSAGE);
    }

    return {
      baseUrl,
      apiBaseUrl,
      adminEmail,
      adminPassword,
      userUsername,
      userEmail,
      userPassword
    };
  } catch {
    throw new Error(INVALID_CONFIG_MESSAGE);
  }
}
