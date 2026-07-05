import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error - Vitest resolves 'svelte' to the server entry; component DOM tests need the client runtime.
import { mount, unmount } from '../../../../node_modules/svelte/src/index-client.js';
import RankingPreviewSection from './RankingPreviewSection.svelte';
import type { HomeRankingPreviewEntry } from '$lib/home/content';

const entries: HomeRankingPreviewEntry[] = [
  { rank: 1, username: 'taro', weeklyScore: 15000, totalGames: 30 },
  { rank: 2, username: 'hanako', weeklyScore: 9200, totalGames: 18 }
];

type RankingPreviewSectionProps = {
  entries: readonly HomeRankingPreviewEntry[];
  moreHref?: string;
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
    const target = renderSection({ entries, moreHref: '/ranking?period=weekly' });

    expect(target.textContent).toContain('1位 taro');
    expect(target.textContent).toContain('30ゲーム');
    expect(target.textContent).toContain('15,000 pt');
    expect(target.querySelector('a')?.getAttribute('href')).toBe('/ranking?period=weekly');
  });

  it('loading: 読み込み中を aria-busy と live region で表示する', () => {
    const target = renderSection({ entries: [], isLoading: true });

    expect(target.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
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

  it('empty: 取得後にランキング対象がない文言を表示する', () => {
    const target = renderSection({
      entries: [],
      emptyMessage: 'まだランキング対象のゲーム結果がありません。'
    });

    expect(target.textContent).toContain('まだランキング対象のゲーム結果がありません。');
  });
});
