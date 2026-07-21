import { expect, test, type Page } from '@playwright/test';

import { loadStagingE2EConfig } from './staging-config';

const stagingConfig = loadStagingE2EConfig(process.env);

async function waitForHydratedLoginForm(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const form = document.querySelector<HTMLFormElement>('form');
    if (!form) {
      return false;
    }

    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    return event.defaultPrevented;
  });
  await expect(page.getByRole('alert')).toHaveText('メールアドレスを入力してください');
}

test('synthetic Adminが対象Userを強制退会し、旧資格情報の再認証を拒否する', async ({ page }) => {
  await page.route(stagingConfig.baseUrl + '/**', async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        'x-vercel-protection-bypass': stagingConfig.vercelProtectionBypassSecret,
        'x-vercel-set-bypass-cookie': 'true'
      }
    });
  });

  await page.goto('/login');
  await waitForHydratedLoginForm(page);
  await page.getByLabel('メールアドレス').fill(stagingConfig.adminEmail);
  await page.getByLabel('パスワード').fill(stagingConfig.adminPassword);

  const adminLoginResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === stagingConfig.apiBaseUrl + '/auth/login' &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  const adminLoginResponse = await adminLoginResponsePromise;
  expect(adminLoginResponse.status()).toBe(200);
  await expect(page).toHaveURL(stagingConfig.baseUrl + '/');

  const adminLink = page.getByRole('link', { name: '管理者', exact: true });
  await expect(adminLink).toBeVisible();
  await adminLink.click();
  await expect(page).toHaveURL(stagingConfig.baseUrl + '/admin');
  await expect(page.getByRole('heading', { name: '管理者ダッシュボード' })).toBeVisible();

  await page.getByLabel('ユーザー名またはメールアドレス').fill(stagingConfig.userUsername);
  await page.getByRole('button', { name: '検索', exact: true }).click();

  const deleteButton = page.locator(
    'button[data-admin-action="delete"][aria-label="' +
      stagingConfig.userUsername +
      'を強制退会"]:visible'
  );
  await expect(deleteButton).toHaveCount(1);
  await deleteButton.click();

  await expect(page.getByRole('dialog', { name: '管理操作の確認' })).toBeVisible();
  await page.getByLabel('確認のため「強制退会」と入力').fill('強制退会');

  const deleteResponsePromise = page.waitForResponse(
    (response) =>
      response.url().startsWith(stagingConfig.apiBaseUrl + '/admin/users/') &&
      response.request().method() === 'DELETE'
  );
  await page.getByRole('button', { name: 'この内容で実行' }).click();
  const deleteResponse = await deleteResponsePromise;
  expect(deleteResponse.status()).toBe(200);
  const successStatus = page.getByRole('status').filter({ hasText: 'ユーザーを強制退会しました' });
  await expect(successStatus).toHaveCount(1);
  await expect(successStatus).toBeVisible();
  await expect(deleteButton).toHaveCount(0);

  await page.context().clearCookies();
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/login');
  await waitForHydratedLoginForm(page);
  await page.getByLabel('メールアドレス').fill(stagingConfig.userEmail);
  await page.getByLabel('パスワード').fill(stagingConfig.userPassword);

  const rejectedLoginResponsePromise = page.waitForResponse(
    (response) =>
      response.url() === stagingConfig.apiBaseUrl + '/auth/login' &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  const rejectedLoginResponse = await rejectedLoginResponsePromise;
  expect(rejectedLoginResponse.status()).toBe(401);
  await expect(page.getByRole('alert')).toHaveText(
    'メールアドレスまたはパスワードが正しくありません'
  );
});
