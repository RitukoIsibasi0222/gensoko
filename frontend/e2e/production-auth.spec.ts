import { expect, test, type APIResponse, type Page } from '@playwright/test';

import { loadProductionE2EConfig } from './production-config';

const productionConfig = loadProductionE2EConfig(process.env);

function summarizeRefreshCookieContract(response: APIResponse) {
  const setCookie = response.headers()['set-cookie'] ?? '';
  return {
    present: setCookie.length > 0,
    httpOnly: /(?:^|;|,)\s*HttpOnly(?:;|,|$)/i.test(setCookie),
    secure: /(?:^|;|,)\s*Secure(?:;|,|$)/i.test(setCookie),
    strict: /(?:^|;)\s*SameSite=Strict(?:;|,|$)/i.test(setCookie),
    authPath: /(?:^|;)\s*Path=\/api\/v1\/auth(?:;|,|$)/i.test(setCookie),
    maxAge: /(?:^|;)\s*Max-Age=604800(?:;|,|$)/i.test(setCookie),
    hostOnly: !/(?:^|;)\s*Domain=/i.test(setCookie)
  };
}

function cookieContractMatches(response: APIResponse): boolean {
  return Object.values(summarizeRefreshCookieContract(response)).every(Boolean);
}

async function reloadWithRefresh(page: Page): Promise<APIResponse> {
  const refreshResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === productionConfig.apiBaseUrl + '/auth/refresh' &&
      response.request().method() === 'POST'
  );
  await page.reload();
  return refreshResponsePromise;
}

test('production auth login・reload・logout・refresh拒否', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('メールアドレス').fill(productionConfig.email);
  await page.getByLabel('パスワード').fill(productionConfig.password);

  const loginResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === productionConfig.apiBaseUrl + '/auth/login' &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);
  expect(cookieContractMatches(loginResponse)).toBe(true);
  await expect(page).toHaveURL(productionConfig.baseUrl + '/');
  await expect(page.getByRole('button', { name: 'ログアウト', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.cookie.includes('refreshToken='))).toBe(false);

  const firstReloadRefresh = await reloadWithRefresh(page);
  expect(firstReloadRefresh.status()).toBe(200);
  expect(cookieContractMatches(firstReloadRefresh)).toBe(true);
  expect(firstReloadRefresh.headers()['set-cookie'] !== loginResponse.headers()['set-cookie']).toBe(
    true
  );
  await expect(page.getByRole('button', { name: 'ログアウト', exact: true })).toBeVisible();
  const secondReloadRefresh = await reloadWithRefresh(page);
  expect(secondReloadRefresh.status()).toBe(200);
  expect(cookieContractMatches(secondReloadRefresh)).toBe(true);
  expect(
    secondReloadRefresh.headers()['set-cookie'] !== firstReloadRefresh.headers()['set-cookie']
  ).toBe(true);
  await expect(page.getByRole('button', { name: 'ログアウト', exact: true })).toBeVisible();

  const concurrentRefreshes = await Promise.all([
    page.request.post(productionConfig.apiBaseUrl + '/auth/refresh', { failOnStatusCode: false }),
    page.request.post(productionConfig.apiBaseUrl + '/auth/refresh', { failOnStatusCode: false })
  ]);
  expect(concurrentRefreshes.map((response) => response.status()).sort()).toEqual([200, 409]);
  const concurrentWinner = concurrentRefreshes.find((response) => response.status() === 200);
  expect(concurrentWinner === undefined ? false : cookieContractMatches(concurrentWinner)).toBe(
    true
  );

  const refreshAfterConflict = await page.request.post(
    productionConfig.apiBaseUrl + '/auth/refresh',
    { failOnStatusCode: false }
  );
  expect(refreshAfterConflict.status()).toBe(200);
  expect(cookieContractMatches(refreshAfterConflict)).toBe(true);

  const logoutResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === productionConfig.apiBaseUrl + '/auth/logout' &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  expect((await logoutResponsePromise).status()).toBe(204);
  await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();

  const rejectedRefresh = await page.request.post(productionConfig.apiBaseUrl + '/auth/refresh', {
    failOnStatusCode: false
  });
  expect(rejectedRefresh.status()).toBe(401);
});
