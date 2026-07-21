// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const FRONTEND_ROOT = fileURLToPath(new URL('../', import.meta.url));
const VITE_CONFIG = readFileSync(FRONTEND_ROOT + 'vite.config.ts', 'utf8');
const PLAYWRIGHT_CONFIG = readFileSync(FRONTEND_ROOT + 'playwright.config.ts', 'utf8');
const PLAYWRIGHT_SPEC = readFileSync(FRONTEND_ROOT + 'e2e/admin-force-delete.spec.ts', 'utf8');
const PACKAGE_JSON = JSON.parse(readFileSync(FRONTEND_ROOT + 'package.json', 'utf8')) as {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('staging Playwright source contract', () => {
  it('通常VitestからPlaywright specを除外し、専用scriptと直接依存を持つ', () => {
    expect(VITE_CONFIG).toContain('configDefaults.exclude');
    expect(VITE_CONFIG).toContain("'e2e/**/*.spec.ts'");
    expect(PACKAGE_JSON.scripts?.['test:e2e:staging']).toBe(
      'playwright test --config playwright.config.ts'
    );
    expect(PACKAGE_JSON.devDependencies?.['@playwright/test']).toBeTruthy();
  });

  it('credentialを含むtrace・screenshot・videoを保存せず単一実行する', () => {
    expect(PLAYWRIGHT_CONFIG).toContain("trace: 'off'");
    expect(PLAYWRIGHT_CONFIG).toContain("screenshot: 'off'");
    expect(PLAYWRIGHT_CONFIG).toContain("video: 'off'");
    expect(PLAYWRIGHT_CONFIG).toContain('workers: 1');
    expect(PLAYWRIGHT_CONFIG).toContain('retries: 0');
    expect(PLAYWRIGHT_CONFIG).not.toContain('extraHTTPHeaders');
  });

  it('Vercel originだけへautomation bypass headerを送りqueryやWorker APIへ漏らさない', () => {
    expect(PLAYWRIGHT_SPEC).toContain("page.route(stagingConfig.baseUrl + '/**'");
    expect(PLAYWRIGHT_SPEC).toContain("'x-vercel-protection-bypass'");
    expect(PLAYWRIGHT_SPEC).toContain('stagingConfig.vercelProtectionBypassSecret');
    expect(PLAYWRIGHT_SPEC).toContain("'x-vercel-set-bypass-cookie': 'true'");
    expect(PLAYWRIGHT_SPEC).not.toContain('?x-vercel-protection-bypass=');
    expect(PLAYWRIGHT_SPEC).not.toContain('page.route(stagingConfig.apiBaseUrl');
  });

  it('client validationでhydration完了を確認してからsynthetic credentialを入力する', () => {
    const hydrationCall = 'await waitForHydratedLoginForm(page);';
    const firstHydrationCallIndex = PLAYWRIGHT_SPEC.indexOf(hydrationCall);
    const secondHydrationCallIndex = PLAYWRIGHT_SPEC.indexOf(
      hydrationCall,
      firstHydrationCallIndex + hydrationCall.length
    );

    expect(PLAYWRIGHT_SPEC).toContain(
      'async function waitForHydratedLoginForm(page: Page): Promise<void>'
    );
    expect(PLAYWRIGHT_SPEC).toContain(
      "const event = new SubmitEvent('submit', { bubbles: true, cancelable: true })"
    );
    expect(PLAYWRIGHT_SPEC).toContain('form.dispatchEvent(event)');
    expect(PLAYWRIGHT_SPEC).toContain('return event.defaultPrevented');
    expect(PLAYWRIGHT_SPEC).toContain(
      "await expect(page.getByRole('alert')).toHaveText('メールアドレスを入力してください')"
    );
    expect(PLAYWRIGHT_SPEC).not.toContain('LOGIN_HYDRATION_PROBE_EMAIL');
    expect(PLAYWRIGHT_SPEC).not.toContain('LOGIN_HYDRATION_PROBE_PASSWORD');
    expect(PLAYWRIGHT_SPEC.split(hydrationCall)).toHaveLength(3);
    expect(firstHydrationCallIndex).toBeGreaterThan(-1);
    expect(firstHydrationCallIndex).toBeLessThan(
      PLAYWRIGHT_SPEC.indexOf('stagingConfig.adminEmail')
    );
    expect(secondHydrationCallIndex).toBeGreaterThan(firstHydrationCallIndex);
    expect(secondHydrationCallIndex).toBeLessThan(
      PLAYWRIGHT_SPEC.indexOf('stagingConfig.userEmail')
    );
  });

  it('Admin login後は認証stateを維持する管理者リンクでSPA遷移し到達URLを確認する', () => {
    const adminLinkDeclaration =
      "const adminLink = page.getByRole('link', { name: '管理者', exact: true });";
    const adminLinkClick = 'await adminLink.click();';
    const adminUrlAssertion = "await expect(page).toHaveURL(stagingConfig.baseUrl + '/admin');";
    const adminHeadingAssertion =
      "await expect(page.getByRole('heading', { name: '管理者ダッシュボード' })).toBeVisible();";

    expect(PLAYWRIGHT_SPEC).toContain(adminLinkDeclaration);
    expect(PLAYWRIGHT_SPEC).toContain('await expect(adminLink).toBeVisible();');
    expect(PLAYWRIGHT_SPEC).toContain(adminLinkClick);
    expect(PLAYWRIGHT_SPEC).toContain(adminUrlAssertion);
    expect(PLAYWRIGHT_SPEC).toContain(adminHeadingAssertion);
    expect(PLAYWRIGHT_SPEC).not.toContain("page.goto('/admin')");

    const adminLoginUrlIndex = PLAYWRIGHT_SPEC.indexOf(
      "await expect(page).toHaveURL(stagingConfig.baseUrl + '/');"
    );
    const adminLinkIndex = PLAYWRIGHT_SPEC.indexOf(adminLinkDeclaration);
    const adminLinkClickIndex = PLAYWRIGHT_SPEC.indexOf(adminLinkClick);
    const adminUrlAssertionIndex = PLAYWRIGHT_SPEC.indexOf(adminUrlAssertion);
    const adminHeadingAssertionIndex = PLAYWRIGHT_SPEC.indexOf(adminHeadingAssertion);

    expect(adminLoginUrlIndex).toBeGreaterThan(-1);
    expect(adminLinkIndex).toBeGreaterThan(adminLoginUrlIndex);
    expect(adminLinkClickIndex).toBeGreaterThan(adminLinkIndex);
    expect(adminUrlAssertionIndex).toBeGreaterThan(adminLinkClickIndex);
    expect(adminHeadingAssertionIndex).toBeGreaterThan(adminUrlAssertionIndex);
  });

  it('Admin login・強制退会・対象User login 401を1つのspecで確認する', () => {
    expect(PLAYWRIGHT_SPEC).toContain('stagingConfig.adminEmail');
    expect(PLAYWRIGHT_SPEC).toContain('data-admin-action="delete"');
    expect(PLAYWRIGHT_SPEC).toContain("response.request().method() === 'DELETE'");
    expect(PLAYWRIGHT_SPEC).toContain("getByRole('status')");
    expect(PLAYWRIGHT_SPEC).not.toContain("getByText('ユーザーを強制退会しました')");
    expect(PLAYWRIGHT_SPEC).toContain('expect(rejectedLoginResponse.status()).toBe(401)');
  });
});
