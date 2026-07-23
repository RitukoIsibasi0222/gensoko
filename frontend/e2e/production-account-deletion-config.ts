import { validateProductionE2EConfig } from './production-config';

export const PRODUCTION_ACCOUNT_DELETION_E2E_CONFIG_ERROR_MESSAGE =
  'production account deletion Playwright設定が不正です';

const PRODUCTION_ACCOUNT_DELETION_USERNAME = 'prod_delete_smoke';
const PRODUCTION_ACCOUNT_DELETION_CONFIRMATION = 'DELETE_PRODUCTION_SYNTHETIC_ACCOUNT';
const PRODUCTION_ACCOUNT_DELETION_EMAIL_PATTERN = /^prod-delete-smoke(?:\+[a-z0-9-]+)?@/;

export type ProductionAccountDeletionE2EConfig = Readonly<{
  baseUrl: string;
  apiBaseUrl: string;
  registrableDomain: string;
  email: string;
  username: typeof PRODUCTION_ACCOUNT_DELETION_USERNAME;
  password: string;
  confirmation: typeof PRODUCTION_ACCOUNT_DELETION_CONFIRMATION;
}>;

function failInvalidConfig(): never {
  throw new Error(PRODUCTION_ACCOUNT_DELETION_E2E_CONFIG_ERROR_MESSAGE);
}

export function loadProductionAccountDeletionE2EConfig(
  environment: Readonly<Record<string, string | undefined>>
): ProductionAccountDeletionE2EConfig {
  try {
    const productionConfig = validateProductionE2EConfig({
      baseUrl: environment.PRODUCTION_E2E_BASE_URL ?? '',
      apiBaseUrl: environment.PRODUCTION_E2E_API_BASE_URL ?? '',
      registrableDomain: environment.PRODUCTION_REGISTRABLE_DOMAIN ?? '',
      email: environment.PRODUCTION_ACCOUNT_DELETION_EMAIL ?? '',
      password: environment.PRODUCTION_ACCOUNT_DELETION_PASSWORD ?? ''
    });
    const username = environment.PRODUCTION_ACCOUNT_DELETION_USERNAME ?? '';
    const confirmation = environment.PRODUCTION_ACCOUNT_DELETION_CONFIRMATION ?? '';

    if (
      username !== PRODUCTION_ACCOUNT_DELETION_USERNAME ||
      !PRODUCTION_ACCOUNT_DELETION_EMAIL_PATTERN.test(productionConfig.email) ||
      confirmation !== PRODUCTION_ACCOUNT_DELETION_CONFIRMATION
    ) {
      failInvalidConfig();
    }

    return {
      ...productionConfig,
      username,
      confirmation
    };
  } catch {
    failInvalidConfig();
  }
}
