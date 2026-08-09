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

function getTokenColors(appCss: string, token: string): readonly [string, string] {
  const tokenValue = appCss.match(
    new RegExp(
      `${token}:\\s*(?:light-dark\\((#[0-9a-f]{6}),\\s*(#[0-9a-f]{6})\\)|(#[0-9a-f]{6}))`,
      'i'
    )
  );
  if (!tokenValue) throw new Error(`${token} の色定義が見つかりません`);

  const solidColor = tokenValue[3];
  return solidColor ? [solidColor, solidColor] : [tokenValue[1], tokenValue[2]];
}

function getContrastRatio(foreground: string, background: string): number {
  const getRelativeLuminance = (hex: string): number => {
    const channels = [1, 3, 5].map(
      (start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255
    );
    const [red, green, blue] = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };

  const foregroundLuminance = getRelativeLuminance(foreground);
  const backgroundLuminance = getRelativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

beforeEach(() => {
  configureBootstrapDocument();
  vi.restoreAllMocks();
});

describe('dark mode bootstrap contract', () => {
  it('ロゴ画像を全ページ共通のfaviconに使う', () => {
    const appHtml = readSource('src/app.html');

    expect(appHtml).toContain(
      '<link rel="icon" type="image/png" href="%sveltekit.assets%/logo.png" />'
    );
  });

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
      '--color-action-text',
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

  it('ライトテーマのブランド・主要アクション・リンクにメインカラーを使う', () => {
    const appCss = readSource('src/app.css');

    expect(getTokenColors(appCss, '--color-brand')[0]).toBe('#014c2d');
    expect(getTokenColors(appCss, '--color-chart-line')).toEqual(['#014c2d', '#6ee7b7']);
    expect(getTokenColors(appCss, '--color-focus')).toEqual(['#014c2d', '#6ee7b7']);
    expect(getTokenColors(appCss, '--color-action')).toEqual(['#014c2d', '#014c2d']);
    expect(getTokenColors(appCss, '--color-action-text')[0]).toBe('#014c2d');
  });

  it('ライトテーマのbody背景に指定したcanvasカラーを使う', () => {
    const appCss = readSource('src/app.css');

    expect(getTokenColors(appCss, '--color-canvas')).toEqual(['#F6FAF9', '#0b1210']);
  });

  it('グレー背景をsurface-mutedの#fafafaに統一する', () => {
    const appCss = readSource('src/app.css');
    const rankingPreview = readSource('src/lib/components/home/RankingPreviewSection.svelte');
    const rankingTable = readSource('src/lib/components/ranking/RankingTable.svelte');

    expect(getTokenColors(appCss, '--color-surface-muted')).toEqual(['#fafafa', '#1d2823']);
    expect(rankingPreview).toContain('bg-surface-muted');
    expect(rankingTable).toContain('bg-surface-muted');
    expect(rankingTable).toContain('scope="row" class="text-text px-4 py-3 text-left');
  });

  it('アプリ概要にセカンダリーの上辺と淡色カードを使う', () => {
    const appCss = readSource('src/app.css');
    const appOverview = readSource('src/lib/components/home/AppOverviewSection.svelte');

    expect(appCss).toContain('--color-secondary-soft: rgb(255 181 0 / 5%)');
    expect(appOverview).toContain('border-t-secondary');
    expect(appOverview).toContain('border-t-[3px]');
    expect(appOverview).toContain('border-secondary bg-secondary-soft');
  });

  it('自分の順位カードにセカンダリーボーダーと基本面色を使う', () => {
    const appCss = readSource('src/app.css');
    const myRankPanel = readSource('src/lib/components/ranking/MyRankPanel.svelte');

    expect(getTokenColors(appCss, '--color-secondary')).toEqual(['#ffb600', '#ffb600']);
    expect(myRankPanel).toContain('border-secondary bg-surface text-text');
    expect(myRankPanel).toContain('class="text-link text-action-text');
    expect(myRankPanel).not.toContain('text-info-text');
  });

  it('ゲーム回答詳細を正誤に応じたブランド配色で表示する', () => {
    const gameResultPage = readSource('src/routes/(app)/game/result/+page.svelte');

    expect(gameResultPage).toContain("'border-brand bg-surface text-brand'");
    expect(gameResultPage).toContain("'border-secondary bg-surface text-danger-text-strong'");
  });

  it('削除ボタンに専用の危険操作カラーを使う', () => {
    const appCss = readSource('src/app.css');
    const weakPage = readSource('src/routes/(app)/weak/+page.svelte');
    const settingsPage = readSource('src/routes/(app)/settings/+page.svelte');
    const adminConfirmation = readSource('src/lib/components/admin/AdminActionConfirmation.svelte');

    expect(getTokenColors(appCss, '--color-danger-action')).toEqual(['#c10202', '#c10202']);
    expect(getTokenColors(appCss, '--color-danger-action-hover')).toEqual(['#9b0202', '#9b0202']);
    for (const source of [weakPage, settingsPage, adminConfirmation]) {
      expect(source).toContain('bg-danger-action');
      expect(source).toContain('hover:bg-danger-action-hover');
    }
  });

  it('各ページのh1直上ラベルをメインカラーと1pxの文字間隔に統一する', () => {
    const appCss = readSource('src/app.css');
    const pageEyebrowSources = [
      ['src/lib/components/home/HeroSection.svelte', 1],
      ['src/routes/(app)/ranking/+page.svelte', 1],
      ['src/routes/(app)/admin/+page.svelte', 1],
      ['src/routes/(app)/game/+page.svelte', 1],
      ['src/routes/(app)/mypage/+page.svelte', 1],
      ['src/routes/(app)/weak/+page.svelte', 1],
      ['src/routes/(app)/game/play/+page.svelte', 3],
      ['src/routes/(app)/game/result/+page.svelte', 2]
    ] as const;

    expect(appCss).toContain('.page-eyebrow');
    expect(appCss).toContain('color: var(--color-action-text)');
    expect(appCss).toContain('letter-spacing: 1px');
    for (const [path, expectedCount] of pageEyebrowSources) {
      expect(readSource(path).match(/page-eyebrow/g)).toHaveLength(expectedCount);
    }
  });

  it('テキストリンクの下線を文字色で上から下へ表示する', () => {
    const appCss = readSource('src/app.css');

    expect(appCss).toContain('.text-link:hover');
    expect(appCss).toContain('text-decoration-color: currentColor');
    expect(appCss).toContain('text-underline-offset: 0.2em');
  });

  it('PCのリンクと有効なボタンだけにポインターカーソルを表示する', () => {
    const appCss = readSource('src/app.css');

    expect(appCss).toContain('@media (hover: hover) and (pointer: fine)');
    expect(appCss).toContain('a[href]');
    expect(appCss).toContain('button:not(:disabled)');
    expect(appCss).toContain('cursor: pointer');
  });

  it('認証パネルの枠色を共通トークンで定義する', () => {
    const appCss = readSource('src/app.css');

    expect(getTokenColors(appCss, '--color-border-panel')).toEqual(['#b3c1bb', '#b3c1bb']);
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
      /\b(?:bg|text|border|divide|outline|ring|stroke|fill)-((?:action|brand|category|danger|disabled|info|secondary|success|surface|text|warning|border|focus|overlay|chart)(?:-[a-z0-9]+)*)\b/g;
    const usedTokens = new Set<string>();

    for (const path of sourceFiles) {
      for (const match of readFileSync(path, 'utf8').matchAll(semanticUtility)) {
        usedTokens.add(match[1]);
      }
    }

    const missingTokens = [...usedTokens].filter((token) => !appCss.includes(`--color-${token}:`));
    expect(missingTokens).toEqual([]);
  });

  it('主要な文字色とfocus indicatorがlight・dark双方でWCAGコントラストを満たす', () => {
    const appCss = readSource('src/app.css');
    const contrastPairs = [
      { foreground: '--color-text', background: '--color-canvas', minimum: 4.5 },
      { foreground: '--color-text-muted', background: '--color-surface', minimum: 4.5 },
      { foreground: '--color-brand', background: '--color-surface', minimum: 4.5 },
      { foreground: '--color-action-text', background: '--color-canvas', minimum: 4.5 },
      { foreground: '--color-action-text', background: '--color-surface', minimum: 4.5 },
      { foreground: '--color-text-inverse', background: '--color-action', minimum: 4.5 },
      { foreground: '--color-text-inverse', background: '--color-danger-solid', minimum: 4.5 },
      { foreground: '--color-text-inverse', background: '--color-danger-action', minimum: 4.5 },
      { foreground: '--color-success-text', background: '--color-success-surface', minimum: 4.5 },
      { foreground: '--color-warning-text', background: '--color-warning-surface', minimum: 4.5 },
      { foreground: '--color-danger-text', background: '--color-danger-surface', minimum: 4.5 },
      { foreground: '--color-info-text', background: '--color-info-surface', minimum: 4.5 },
      { foreground: '--color-focus', background: '--color-surface', minimum: 3 }
    ] as const;

    for (const pair of contrastPairs) {
      const foregroundColors = getTokenColors(appCss, pair.foreground);
      const backgroundColors = getTokenColors(appCss, pair.background);

      for (const [themeIndex, theme] of ['light', 'dark'].entries()) {
        const ratio = getContrastRatio(foregroundColors[themeIndex], backgroundColors[themeIndex]);
        expect(
          ratio,
          `${theme}: ${pair.foreground} / ${pair.background} のコントラスト比`
        ).toBeGreaterThanOrEqual(pair.minimum);
      }
    }
  });
});
