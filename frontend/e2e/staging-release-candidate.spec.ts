import { expect, test } from '@playwright/test';

import { waitForHydratedLoginForm } from './login-form';
import { loadM2StagingE2EConfig } from './staging-release-candidate-config';

test('M2 synthetic userのkeyboard・320px・game・本人退会を確認する', async ({ page }) => {
  const config = loadM2StagingE2EConfig(process.env);
  if (config.crossSiteRefreshEvidence !== 'protocol-only') {
    throw new Error('M2 staging Playwright設定が不正です');
  }

  await page.setViewportSize({ width: 320, height: 720 });
  await page.route(config.baseUrl + '/**', async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        'x-vercel-protection-bypass': config.vercelProtectionBypassSecret,
        'x-vercel-set-bypass-cookie': 'true'
      }
    });
  });

  await page.goto('/login');
  await waitForHydratedLoginForm(page);
  await page.getByLabel('メールアドレス').fill(config.email);
  await page.getByLabel('パスワード').fill(config.password);
  const loginResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === config.apiBaseUrl + '/auth/login' && response.request().method() === 'POST'
  );
  const loginButton = page.getByRole('button', { name: 'ログイン', exact: true });
  await loginButton.focus();
  await loginButton.press('Enter');
  expect((await loginResponsePromise).status()).toBe(200);
  await expect(page).toHaveURL(config.baseUrl + '/');

  const gameLink = page.getByRole('link', { name: 'ゲーム', exact: true }).first();
  await gameLink.focus();
  await gameLink.press('Enter');
  await expect(page).toHaveURL(config.baseUrl + '/game');
  const startButton = page.getByRole('button', { name: 'このモードで始める' }).first();
  await startButton.focus();
  await startButton.press('Enter');
  await expect(page.getByRole('heading', { name: '答えを選択' })).toBeVisible();

  for (let questionIndex = 0; questionIndex < 10; questionIndex += 1) {
    await page.keyboard.press('1');
    if (questionIndex < 9) {
      await page.waitForTimeout(1_600);
    }
  }
  await expect(page.getByRole('heading', { name: 'ゲーム結果' })).toBeVisible({
    timeout: 20_000
  });

  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
  );
  expect(fitsViewport).toBe(true);

  const settingsLink = page.getByRole('link', { name: '設定', exact: true }).first();
  await settingsLink.focus();
  await settingsLink.press('Enter');
  await expect(page).toHaveURL(config.baseUrl + '/settings');

  await page.getByLabel('現在のパスワード').last().fill(config.password);
  const acknowledgement = page.getByLabel(
    '上記の内容を確認し、アカウントを削除することに同意します。'
  );
  await acknowledgement.focus();
  await acknowledgement.press('Space');
  const deleteResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === config.apiBaseUrl + '/users/me' && response.request().method() === 'DELETE'
  );
  const deleteButton = page.getByRole('button', { name: 'アカウントを削除する' });
  await deleteButton.focus();
  await deleteButton.press('Enter');
  expect((await deleteResponsePromise).status()).toBe(200);
  await expect(page).toHaveURL(config.baseUrl + '/login');
});
