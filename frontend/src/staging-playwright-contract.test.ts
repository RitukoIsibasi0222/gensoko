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
  });

  it('Admin login・強制退会・対象User login 401を1つのspecで確認する', () => {
    expect(PLAYWRIGHT_SPEC).toContain('stagingConfig.adminEmail');
    expect(PLAYWRIGHT_SPEC).toContain('data-admin-action="delete"');
    expect(PLAYWRIGHT_SPEC).toContain("response.request().method() === 'DELETE'");
    expect(PLAYWRIGHT_SPEC).toContain('expect(rejectedLoginResponse.status()).toBe(401)');
  });
});
