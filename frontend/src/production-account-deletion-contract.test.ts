// @vitest-environment node

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FRONTEND_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG_PATH = FRONTEND_ROOT + 'playwright.production-account-deletion.config.ts';
const E2E_TSCONFIG_PATH = FRONTEND_ROOT + 'tsconfig.e2e.json';
const SPEC_PATH = FRONTEND_ROOT + 'e2e/production-account-deletion.spec.ts';
const WORKFLOW_PATH = FRONTEND_ROOT + '../.github/workflows/production-account-deletion-smoke.yml';

function readFileOrEmpty(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const CONFIG = readFileOrEmpty(CONFIG_PATH);
const E2E_TSCONFIG = readFileOrEmpty(E2E_TSCONFIG_PATH);
const SPEC = readFileOrEmpty(SPEC_PATH);
const WORKFLOW = readFileOrEmpty(WORKFLOW_PATH);
const PACKAGE_JSON = JSON.parse(readFileSync(FRONTEND_ROOT + 'package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};

describe('production account deletion smoke source contract', () => {
  it('通常production smokeと分離した専用config・spec・scriptを持つ', () => {
    expect(CONFIG).not.toBe('');
    expect(SPEC).not.toBe('');
    expect(WORKFLOW).not.toBe('');
    expect(PACKAGE_JSON.scripts?.['test:e2e:production-account-deletion']).toBe(
      'playwright test --config playwright.production-account-deletion.config.ts'
    );
    expect(PACKAGE_JSON.scripts?.['check:e2e']).toBe('tsc --noEmit -p tsconfig.e2e.json');
    expect(E2E_TSCONFIG).toContain('"e2e/**/*.ts"');
    expect(E2E_TSCONFIG).toContain('"playwright*.config.ts"');
    expect(CONFIG).toContain("testMatch: 'production-account-deletion.spec.ts'");
  });

  it('destructive smokeのtrace・screenshot・video・storageState・出力を保存しない', () => {
    expect(CONFIG).toContain("trace: 'off'");
    expect(CONFIG).toContain("screenshot: 'off'");
    expect(CONFIG).toContain("video: 'off'");
    expect(CONFIG).toContain("preserveOutput: 'never'");
    expect(CONFIG).toContain('workers: 1');
    expect(CONFIG).toContain('retries: 0');
    expect(CONFIG).not.toContain('storageState');
    expect(SPEC).not.toContain('context.cookies');
    expect(SPEC).not.toContain('storageState');
    expect(SPEC).not.toContain('testInfo.attach');
    expect(SPEC).not.toContain('console.');
    expect(SPEC).toContain("import { waitForHydratedLoginForm } from './login-form';");
    expect(SPEC).not.toContain('async function waitForHydratedLoginForm');
  });

  it('mainはexact USERと発行済みrefresh tokenを確認してUI削除後に旧認証の401を確認する', () => {
    expect(SPEC).toContain('loadProductionAccountDeletionE2EConfig');
    expect(SPEC).toContain('PRODUCTION_ACCOUNT_DELETION_OPERATION');
    expect(SPEC).toContain("'main'");
    expect(SPEC).toContain("'/auth/login'");
    expect(SPEC).toContain("'/users/me'");
    expect(SPEC).toContain("'/auth/refresh'");
    expect(SPEC).toContain("name: '設定'");
    expect(SPEC).toContain("'#delete-current-password'");
    expect(SPEC).toContain("name: 'アカウントを削除する'");
    expect(SPEC).toContain('findIssuedRefreshToken');
    expect(SPEC).toContain('refreshTokenBeforeDeletion');
    expect(SPEC).toContain("Cookie: 'refreshToken=' + refreshTokenBeforeDeletion");
    expect(SPEC).toContain('matchesRefreshCookieDeletionContract');
    expect(SPEC).toContain("await page.keyboard.press('Space')");
    expect(SPEC).toContain("await page.keyboard.press('Enter')");
    expect(SPEC.match(/\.toBe\(401\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(SPEC).toContain("role !== 'USER'");
  });

  it('recoveryは401を削除済みと推測せず、200かつexact profile確認後だけ再削除する', () => {
    expect(SPEC).toContain("'recovery'");
    expect(SPEC).toContain("'completed'");
    expect(SPEC).toContain("'failed'");
    expect(SPEC).not.toContain("return 'not-required'");
    expect(SPEC).toContain('if (loginResponse.status() !== 200)');
    expect(SPEC).toContain('profile.email !== productionConfig.email');
    expect(SPEC).toContain('profile.username !== productionConfig.username');
    expect(SPEC).toContain("profile.role !== 'USER'");
    expect(SPEC).toContain('PRODUCTION_ACCOUNT_DELETION_STATUS_PATH');
    expect(SPEC).toContain('writeFileSync');
    expect(SPEC).toContain('PRODUCTION_ACCOUNT_DELETION_SMOKE_ERROR_MESSAGE');
  });

  it('workflowはmanual・main・review済みSHA・production Environment・多重gateに限定する', () => {
    expect(WORKFLOW).toContain('workflow_dispatch:');
    expect(WORKFLOW).not.toMatch(/^\s+(push|pull_request|schedule):/m);
    expect(WORKFLOW).toContain('operation:');
    expect(WORKFLOW).toContain('reviewed_sha:');
    expect(WORKFLOW).toContain('confirmation:');
    expect(WORKFLOW).toContain('approved_by:');
    expect(WORKFLOW).toContain('change_record:');
    expect(WORKFLOW.match(/environment: production/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(WORKFLOW).toContain('PRODUCTION_ACCOUNT_DELETION_SMOKE_ENABLED');
    expect(WORKFLOW).toContain('DELETE_PRODUCTION_SYNTHETIC_ACCOUNT');
    expect(WORKFLOW).toContain('GITHUB_REF_NAME');
    expect(WORKFLOW).toContain('inputs.reviewed_sha');
    expect(WORKFLOW).toContain('contents: read');
  });

  it('main非成功またはrecovery-only時だけ別jobでexact recoveryを実行する', () => {
    expect(WORKFLOW).toContain('production-account-deletion-main:');
    expect(WORKFLOW).toContain('recover-production-account-deletion:');
    expect(WORKFLOW).toContain('- production-account-deletion-main');
    expect(WORKFLOW).toContain("needs['production-account-deletion-main'].result != 'success'");
    expect(WORKFLOW).toContain("inputs.operation == 'recovery-only'");
    expect(WORKFLOW).toContain('PRODUCTION_ACCOUNT_DELETION_OPERATION: recovery');
    expect(WORKFLOW).toContain('npm run test:e2e:production-account-deletion');
    expect(WORKFLOW).toContain('GITHUB_STEP_SUMMARY');
    expect(WORKFLOW).toContain('completed|failed');
    expect(WORKFLOW).not.toContain('completed|not-required|failed');
  });

  it('credentialをjob全体・CLI・output・artifactへ渡さずmain/recovery stepだけへ限定する', () => {
    expect(WORKFLOW).toContain('secrets.PRODUCTION_ACCOUNT_DELETION_EMAIL');
    expect(WORKFLOW).toContain('secrets.PRODUCTION_ACCOUNT_DELETION_PASSWORD');
    expect(WORKFLOW.match(/PRODUCTION_ACCOUNT_DELETION_PASSWORD:/g)?.length).toBe(2);
    expect(WORKFLOW.match(/PRODUCTION_ACCOUNT_DELETION_EMAIL:/g)?.length).toBe(2);
    expect(WORKFLOW).not.toContain('GITHUB_OUTPUT');
    expect(WORKFLOW).not.toContain('GITHUB_ENV');
    expect(WORKFLOW).not.toContain('upload-artifact');
    expect(WORKFLOW).not.toContain('--password');
    expect(WORKFLOW).not.toContain('--email');
  });
});
