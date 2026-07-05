import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount } from '$lib/test/svelte-client';
import RankingPreviewSection from './RankingPreviewSection.svelte';
import type { HomeRankingPreviewEntry } from '$lib/home/content';

const entries: HomeRankingPreviewEntry[] = [
  { rank: 1, username: 'taro', weeklyScore: 15000, totalGames: 30 },
  { rank: 2, username: 'hanako', weeklyScore: 9200, totalGames: 18 }
];

type RankingPreviewSectionProps = {
  entries: readonly HomeRankingPreviewEntry[];
  moreHref?: string;
  moreAriaLabel?: string;
  emptyMessage?: string;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
};

let mounted: ReturnType<typeof mount> | null = null;

function renderSection(props: RankingPreviewSectionProps): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(RankingPreviewSection, { target, props });
  return target;
}

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('RankingPreviewSection', () => {
  it('success: 週間ランキング項目と詳細導線を表示する', () => {
    const target = renderSection({
      entries,
      moreHref: '/ranking?period=weekly',
      moreAriaLabel: '週間ランキングをもっと見る'
    });

    expect(target.textContent).toContain('1位 taro');
    expect(target.textContent).toContain('30ゲーム');
    expect(target.textContent).toContain('15,000 pt');
    const link = target.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/ranking?period=weekly');
    expect(link?.getAttribute('aria-label')).toBe('週間ランキングをもっと見る');
  });

  it('default: 詳細導線の aria-label は汎用文言を使う', () => {
    const target = renderSection({ entries });

    const link = target.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/ranking');
    expect(link?.getAttribute('aria-label')).toBe('ランキングをもっと見る');
  });

  it('loading: 読み込み中を aria-busy と live region で表示する', () => {
    const target = renderSection({ entries: [], isLoading: true });

    const section = target.querySelector('section');
    expect(section?.getAttribute('aria-labelledby')).toBe('home-ranking-preview-heading');
    expect(target.querySelector('#home-ranking-preview-heading')?.textContent).toContain(
      'ランキングプレビュー'
    );
    expect(section?.getAttribute('aria-busy')).toBe('true');
    expect(target.querySelector('[aria-live=polite]')?.textContent).toContain(
      'ランキングを読み込んでいます...'
    );
  });

  it('error: エラーメッセージと再試行ボタンを表示する', () => {
    const onRetry = vi.fn();
    const target = renderSection({
      entries: [],
      errorMessage: 'ランキングの取得に失敗しました',
      onRetry
    });

    expect(target.querySelector('[role=alert]')?.textContent).toContain(
      'ランキングの取得に失敗しました'
    );
    const button = target.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toContain('再試行');
    button.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('error: 空文字の errorMessage でも error 状態として扱う', () => {
    const target = renderSection({ entries: [], errorMessage: '' });

    expect(target.querySelector('[role=alert]')).not.toBeNull();
    expect(target.textContent).not.toContain('ランキングは準備中です。');
  });

  it('empty: 取得後にランキング対象がない文言を表示する', () => {
    const target = renderSection({
      entries: [],
      emptyMessage: 'まだランキング対象のゲーム結果がありません。'
    });

    expect(target.textContent).toContain('まだランキング対象のゲーム結果がありません。');
  });
});
