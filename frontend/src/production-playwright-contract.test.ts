// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FRONTEND_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG = readFileSync(FRONTEND_ROOT + 'playwright.production.config.ts', 'utf8');
const SPEC = readFileSync(FRONTEND_ROOT + 'e2e/production-auth.spec.ts', 'utf8');
const WORKFLOW = readFileSync(
  FRONTEND_ROOT + '../.github/workflows/production-auth-smoke.yml',
  'utf8'
);
const PACKAGE_JSON = JSON.parse(readFileSync(FRONTEND_ROOT + 'package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};

describe('production auth smoke source contract', () => {
  it('trace・screenshot・video・storageState・Cookie一覧を保存しない', () => {
    expect(CONFIG).toContain("trace: 'off'");
    expect(CONFIG).toContain("screenshot: 'off'");
    expect(CONFIG).toContain("video: 'off'");
    expect(CONFIG).toContain("preserveOutput: 'never'");
    expect(CONFIG).toContain('workers: 1');
    expect(CONFIG).toContain('retries: 0');
    expect(CONFIG).not.toContain('storageState');
    expect(SPEC).not.toContain('context.cookies');
    expect(SPEC).not.toContain('storageState');
    expect(SPEC).not.toContain('console.');
  });

  it('login・2回reload・logout・refresh拒否を値非表示で確認する', () => {
    expect(SPEC).toContain("'/auth/login'");
    expect(SPEC.match(/reloadWithRefresh\(page\)/g)).toHaveLength(2);
    expect(SPEC).toContain("'/auth/logout'");
    expect(SPEC).toContain("'/auth/refresh'");
    expect(SPEC).toContain('document.cookie');
    expect(SPEC).toContain('summarizeRefreshCookieContract');
    expect(SPEC).toContain('cookieContractMatches');
    expect(SPEC).toContain('[200, 409]');
  });

  it('production Environmentの手動workflowだけから実行できる', () => {
    expect(WORKFLOW).toContain('workflow_dispatch:');
    expect(WORKFLOW).toContain('environment: production');
    expect(WORKFLOW).not.toMatch(/^\s+(push|pull_request|schedule):/m);
    expect(WORKFLOW).not.toContain('upload-artifact');
    expect(PACKAGE_JSON.scripts?.['test:e2e:production']).toBe(
      'playwright test --config playwright.production.config.ts'
    );
  });
});
