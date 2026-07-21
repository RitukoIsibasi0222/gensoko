import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const frontendRoot = process.cwd();
const sourceRoot = resolve(frontendRoot, 'src');

function readSource(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8');
}

function collectFiles(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(path, extension);
    return extname(entry.name) === extension ? [path] : [];
  });
}

function getBootstrapSource(appHtml: string): string {
  const match = appHtml.match(/<script\s+nonce="%sveltekit\.nonce%">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('nonce付きtheme bootstrapが見つかりません');
  return match[1];
}

function configureBootstrapDocument(): void {
  document.documentElement.dataset.themeStorageKey = 'gensoko-theme-v1';
  document.documentElement.dataset.themeMediaQuery = '(prefers-color-scheme: dark)';
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
  localStorage.clear();
}

beforeEach(() => {
  configureBootstrapDocument();
  vi.restoreAllMocks();
});

describe('dark mode bootstrap contract', () => {
  it('CSP nonce付きbootstrapをSvelteKit headより前に実行する', () => {
    const appHtml = readSource('src/app.html');
    const bootstrapIndex = appHtml.indexOf('<script nonce="%sveltekit.nonce%">');

    expect(appHtml).toContain('data-theme-storage-key="gensoko-theme-v1"');
    expect(appHtml).toContain('data-theme-media-query="(prefers-color-scheme: dark)"');
    expect(bootstrapIndex).toBeGreaterThan(-1);
    expect(bootstrapIndex).toBeLessThan(appHtml.indexOf('%sveltekit.head%'));
    expect(appHtml).not.toContain('unsafe-inline');
  });

  it('保存済みdarkを初期描画前にdocument rootへ適用する', () => {
    const appHtml = readSource('src/app.html');
    localStorage.setItem('gensoko-theme-v1', 'dark');
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }))
    );

    new Function(getBootstrapSource(appHtml))();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('不正な保存値を削除しOS darkへfallbackする', () => {
    const appHtml = readSource('src/app.html');
    localStorage.setItem('gensoko-theme-v1', 'sepia');
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }))
    );

    new Function(getBootstrapSource(appHtml))();

    expect(localStorage.getItem('gensoko-theme-v1')).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('dark mode source contract', () => {
  it('themeをauthより先にbrowser境界で初期化する', () => {
    const rootLayout = readSource('src/routes/+layout.svelte');
    const themeInitializeIndex = rootLayout.indexOf('themeStore.initialize()');
    const authInitializeIndex = rootLayout.indexOf('authStore.initialize()');

    expect(rootLayout).toContain("import { browser } from '$app/environment'");
    expect(themeInitializeIndex).toBeGreaterThan(-1);
    expect(themeInitializeIndex).toBeLessThan(authInitializeIndex);
  });

  it('global semantic tokenとdark override・reduced motionを定義する', () => {
    const appCss = readSource('src/app.css');

    for (const token of [
      '--color-canvas',
      '--color-surface',
      '--color-elevated',
      '--color-text',
      '--color-text-muted',
      '--color-border',
      '--color-focus',
      '--color-action',
      '--color-success-surface',
      '--color-warning-surface',
      '--color-danger-surface',
      '--color-info-surface',
      '--color-overlay'
    ]) {
      expect(appCss, token).toContain(token);
    }
    expect(appCss).toContain(":root[data-theme='dark']");
    expect(appCss).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('Svelte UIと元素分類styleに固定light paletteを残さない', () => {
    const sourceFiles = [
      ...collectFiles(sourceRoot, '.svelte'),
      ...collectFiles(sourceRoot, '.ts').filter((path) => !path.endsWith('.test.ts'))
    ];
    const forbiddenPalette =
      /\b(?:bg|text|border|divide|outline|ring|stroke|fill)-(?:white|black(?:\/\d+)?|(?:gray|slate|red|blue|green|yellow|amber|emerald|sky|rose|orange|teal|lime|fuchsia|violet|indigo)-\d+)\b/g;
    const violations = sourceFiles.flatMap((path) => {
      const matches = readFileSync(path, 'utf8').match(forbiddenPalette) ?? [];
      return [...new Set(matches)].map((className) => ({
        file: path.replace(`${frontendRoot}/`, ''),
        className
      }));
    });

    expect(violations).toEqual([]);
  });

  it('使用するcustom color utilityをすべてglobal tokenへ解決する', () => {
    const appCss = readSource('src/app.css');
    const sourceFiles = [
      ...collectFiles(sourceRoot, '.svelte'),
      ...collectFiles(sourceRoot, '.ts').filter((path) => !path.endsWith('.test.ts'))
    ];
    const semanticUtility =
      /\b(?:bg|text|border|divide|outline|ring|stroke|fill)-((?:action|brand|category|danger|disabled|info|success|surface|text|warning|border|focus|overlay|chart)(?:-[a-z0-9]+)*)\b/g;
    const usedTokens = new Set<string>();

    for (const path of sourceFiles) {
      for (const match of readFileSync(path, 'utf8').matchAll(semanticUtility)) {
        usedTokens.add(match[1]);
      }
    }

    const missingTokens = [...usedTokens].filter((token) => !appCss.includes(`--color-${token}:`));
    expect(missingTokens).toEqual([]);
  });
});
