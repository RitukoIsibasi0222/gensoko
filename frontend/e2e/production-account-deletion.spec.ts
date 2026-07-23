import { writeFileSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page
} from '@playwright/test';

import {
  loadProductionAccountDeletionE2EConfig,
  type ProductionAccountDeletionRecoveryStatus
} from './production-account-deletion-config';
import { waitForHydratedLoginForm } from './login-form';

export const PRODUCTION_ACCOUNT_DELETION_SMOKE_ERROR_MESSAGE =
  '本番アカウント削除smokeが安全に完了しませんでした';

type ProductionAccountDeletionOperation = 'main' | 'recovery';

const productionConfig = loadProductionAccountDeletionE2EConfig(process.env);
const operation = loadOperation(process.env);
const statusPath = loadStatusPath(process.env, operation);

function failSmoke(): never {
  throw new Error(PRODUCTION_ACCOUNT_DELETION_SMOKE_ERROR_MESSAGE);
}

function loadOperation(
  environment: Readonly<Record<string, string | undefined>>
): ProductionAccountDeletionOperation {
  const value = environment.PRODUCTION_ACCOUNT_DELETION_OPERATION;
  if (value !== 'main' && value !== 'recovery') {
    failSmoke();
  }
  return value;
}

function loadStatusPath(
  environment: Readonly<Record<string, string | undefined>>,
  currentOperation: ProductionAccountDeletionOperation
): string {
  const value = environment.PRODUCTION_ACCOUNT_DELETION_STATUS_PATH ?? '';
  const expectedBasename =
    currentOperation === 'main'
      ? 'production-account-deletion-main-status.txt'
      : 'production-account-deletion-recovery-status.txt';
  if (!isAbsolute(value) || value !== value.trim() || basename(value) !== expectedBasename) {
    failSmoke();
  }
  return value;
}

function writeStatus(status: ProductionAccountDeletionRecoveryStatus): void {
  writeFileSync(statusPath, status + '\n', { encoding: 'utf8', flag: 'w' });
}

function writeFailedStatus(): void {
  try {
    writeStatus('failed');
  } catch {
    // workflow側はstatus file欠落もfailedとして扱うため、秘密値を含むraw errorは出さない
  }
}

async function readJson(response: APIResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    failSmoke();
  }
}

function requireExactLoginResponse(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    failSmoke();
  }
  const response = value as Record<string, unknown>;
  const user = response.user;
  if (user === null || typeof user !== 'object' || Array.isArray(user)) {
    failSmoke();
  }
  const loginUser = user as Record<string, unknown>;
  if (
    typeof response.accessToken !== 'string' ||
    response.accessToken.length === 0 ||
    loginUser.username !== productionConfig.username ||
    loginUser.role !== 'USER'
  ) {
    failSmoke();
  }
  return response.accessToken;
}

function requireExactProfile(value: unknown): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    failSmoke();
  }
  const response = value as Record<string, unknown>;
  if (response.user === null || typeof response.user !== 'object' || Array.isArray(response.user)) {
    failSmoke();
  }
  const profile = response.user as Record<string, unknown>;
  if (
    profile.email !== productionConfig.email ||
    profile.username !== productionConfig.username ||
    profile.role !== 'USER'
  ) {
    failSmoke();
  }
}

async function requireExactProfileFromApi(
  request: APIRequestContext,
  accessToken: string
): Promise<void> {
  const response = await request.get(productionConfig.apiBaseUrl + '/users/me', {
    headers: { Authorization: 'Bearer ' + accessToken },
    failOnStatusCode: false
  });
  if (response.status() !== 200) {
    failSmoke();
  }
  requireExactProfile(await readJson(response));
}

function cookieDeletionContractMatches(response: APIResponse): boolean {
  const setCookie = response.headers()['set-cookie'] ?? '';
  const refreshCookieCount = setCookie.match(/(?:^|,)\s*refreshToken=/g)?.length ?? 0;
  const deletionMarkerCount = setCookie.match(/Max-Age=0|Expires=/g)?.length ?? 0;
  return (
    refreshCookieCount >= 2 &&
    deletionMarkerCount >= 2 &&
    /Path=\/api\/v1\/auth(?!\/)/.test(setCookie) &&
    setCookie.includes('Path=/api/v1/auth/refresh') &&
    !setCookie.includes('Max-Age=604800')
  );
}

function hasLiveRefreshCookie(response: APIResponse): boolean {
  const setCookie = response.headers()['set-cookie'] ?? '';
  return setCookie.includes('refreshToken=') && setCookie.includes('Max-Age=604800');
}

async function runMain(page: Page): Promise<void> {
  await page.goto('/login');
  await waitForHydratedLoginForm(page);
  await page.getByLabel('メールアドレス').fill(productionConfig.email);
  await page.getByLabel('パスワード').fill(productionConfig.password);

  const loginResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === productionConfig.apiBaseUrl + '/auth/login' &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  const loginResponse = await loginResponsePromise;
  if (loginResponse.status() !== 200) {
    failSmoke();
  }
  const accessTokenBeforeDeletion = requireExactLoginResponse(await readJson(loginResponse));
  await requireExactProfileFromApi(page.request, accessTokenBeforeDeletion);
  await expect(page).toHaveURL(productionConfig.baseUrl + '/');

  const settingsLink = page.getByRole('link', { name: '設定', exact: true });
  await expect(settingsLink).toBeVisible();
  await settingsLink.click();
  await expect(page).toHaveURL(productionConfig.baseUrl + '/settings');

  const deleteSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'アカウント削除', exact: true })
  });
  await deleteSection.locator('#delete-current-password').fill(productionConfig.password);
  await deleteSection.getByRole('checkbox').check();

  const deleteResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === productionConfig.apiBaseUrl + '/users/me' &&
      response.request().method() === 'DELETE'
  );
  await deleteSection.getByRole('button', { name: 'アカウントを削除する', exact: true }).click();
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(200);
  expect(cookieDeletionContractMatches(deleteResponse)).toBe(true);
  await expect(page).toHaveURL(productionConfig.baseUrl + '/');
  await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();

  const rejectedAccess = await page.request.get(productionConfig.apiBaseUrl + '/users/me', {
    headers: { Authorization: 'Bearer ' + accessTokenBeforeDeletion },
    failOnStatusCode: false
  });
  expect(rejectedAccess.status()).toBe(401);

  const rejectedRefresh = await page.request.post(productionConfig.apiBaseUrl + '/auth/refresh', {
    failOnStatusCode: false
  });
  expect(rejectedRefresh.status()).toBe(401);
  expect(hasLiveRefreshCookie(rejectedRefresh)).toBe(false);

  const rejectedLogin = await page.request.post(productionConfig.apiBaseUrl + '/auth/login', {
    data: { email: productionConfig.email, password: productionConfig.password },
    failOnStatusCode: false
  });
  expect(rejectedLogin.status()).toBe(401);
}

async function runRecovery(
  request: APIRequestContext
): Promise<ProductionAccountDeletionRecoveryStatus> {
  const loginResponse = await request.post(productionConfig.apiBaseUrl + '/auth/login', {
    data: { email: productionConfig.email, password: productionConfig.password },
    failOnStatusCode: false
  });
  if (loginResponse.status() === 401) {
    return 'not-required';
  }
  if (loginResponse.status() !== 200) {
    failSmoke();
  }

  const accessToken = requireExactLoginResponse(await readJson(loginResponse));
  await requireExactProfileFromApi(request, accessToken);
  const deleteResponse = await request.delete(productionConfig.apiBaseUrl + '/users/me', {
    headers: { Authorization: 'Bearer ' + accessToken },
    data: { currentPassword: productionConfig.password },
    failOnStatusCode: false
  });
  if (deleteResponse.status() !== 200 || !cookieDeletionContractMatches(deleteResponse)) {
    failSmoke();
  }
  return 'completed';
}

test('production synthetic USERを本人削除し、旧認証を拒否する', async ({ page }) => {
  test.skip(operation !== 'main', 'main operationだけで実行します');
  try {
    await runMain(page);
    writeStatus('completed');
  } catch {
    writeFailedStatus();
    failSmoke();
  }
});

test('production synthetic USERの削除状態を安全にrecoveryする', async ({ request }) => {
  test.skip(operation !== 'recovery', 'recovery operationだけで実行します');
  try {
    writeStatus(await runRecovery(request));
  } catch {
    writeFailedStatus();
    failSmoke();
  }
});
