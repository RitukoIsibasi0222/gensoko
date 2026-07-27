// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SPEC_PATH = fileURLToPath(new URL('./staging-release-candidate.spec.ts', import.meta.url));

describe('M2 staging Playwright source contract', () => {
  it('Vercel bypassを固定frontend originだけへ送りAPIへ漏らさない', () => {
    const source = readFileSync(SPEC_PATH, 'utf8');

    expect(source).toContain("page.route(config.baseUrl + '/**'");
    expect(source).toContain("'x-vercel-protection-bypass'");
    expect(source).not.toContain('page.route(config.apiBaseUrl');
    expect(source).not.toContain('?x-vercel-protection-bypass=');
  });

  it('keyboard・320px・game結果・本人退会を1 specで確認する', () => {
    const source = readFileSync(SPEC_PATH, 'utf8');

    expect(source).toContain('page.setViewportSize({ width: 320');
    expect(source).toContain("press('Enter')");
    expect(source).toContain("page.keyboard.press('1')");
    expect(source).toContain('document.documentElement.scrollWidth <= window.innerWidth');
    expect(source).toContain("getByRole('heading', { name: 'ゲーム結果' })");
    expect(source).toContain("getByRole('button', { name: 'アカウントを削除する' })");
    expect(source).toContain("press('Space')");
  });

  it('staging browser結果をproduction same-site refresh証拠へ昇格しない', () => {
    const source = readFileSync(SPEC_PATH, 'utf8');

    expect(source).toContain("crossSiteRefreshEvidence !== 'protocol-only'");
    expect(source).not.toMatch(/sameSiteRefresh|browserRefresh/);
    expect(source).not.toMatch(/trace|screenshot|video|html/i);
  });
});
