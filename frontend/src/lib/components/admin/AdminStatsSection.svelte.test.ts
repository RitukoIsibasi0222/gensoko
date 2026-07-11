import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount } from '$lib/test/svelte-client';
import AdminStatsSection from './AdminStatsSection.svelte';
import type { AdminStats } from '$lib/api/admin';

const STATS: AdminStats = {
  users: {
    total: 30,
    active: 24,
    suspended: 3,
    deleted: 3,
    admins: 2,
    emailVerified: 25
  },
  games: {
    totalSessions: 140,
    totalAnswered: 1400,
    averageAccuracyRate: 78
  },
  learning: {
    totalWeakElements: 45,
    totalMasteredCount: 210
  }
};

type StatsProps = {
  stats: AdminStats | null;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
};

let mounted: ReturnType<typeof mount> | null = null;

function renderStats(props: StatsProps): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(AdminStatsSection, { target, props });
  return target;
}

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('AdminStatsSection', () => {
  it('統計の意味を誤解しないラベルと値を表示する', () => {
    const target = renderStats({ stats: STATS });

    expect(target.textContent).toContain('登録ユーザー累計（退会含む）');
    expect(target.textContent).toContain('30');
    expect(target.textContent).toContain('未退会ADMIN');
    expect(target.textContent).toContain('2');
    expect(target.textContent).toContain('メール確認済み（未退会）');
    expect(target.textContent).toContain('25');
    expect(target.textContent).not.toContain('利用可能な管理者');
  });

  it('ユーザー・ゲーム・学習を見出し付きの独立グループで表示する', () => {
    const target = renderStats({ stats: STATS });

    const section = target.querySelector('section');
    expect(section?.getAttribute('aria-labelledby')).toBe('admin-stats-heading');
    expect(target.querySelector('#admin-stats-heading')?.textContent).toContain('サービス統計');
    expect(target.textContent).toContain('ユーザー');
    expect(target.textContent).toContain('ゲーム');
    expect(target.textContent).toContain('学習');
    expect(target.textContent).toContain('平均正答率');
    expect(target.textContent).toContain('78%');
  });

  it('loadingをaria-busyとlive regionで通知する', () => {
    const target = renderStats({ stats: null, isLoading: true });

    expect(target.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
    expect(target.querySelector('[aria-live=polite]')?.textContent).toContain(
      'サービス統計を読み込んでいます'
    );
  });

  it('部分errorと再試行ボタンを表示し、一覧から独立してretryできる', () => {
    const onRetry = vi.fn();
    const target = renderStats({
      stats: null,
      errorMessage: '統計情報の取得に失敗しました',
      onRetry
    });

    expect(target.querySelector('[role=alert]')?.textContent).toContain(
      '統計情報の取得に失敗しました'
    );
    const retryButton = target.querySelector('button') as HTMLButtonElement;
    expect(retryButton.textContent).toContain('統計を再読み込み');
    retryButton.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('取得前の空状態で架空の0件を表示しない', () => {
    const target = renderStats({ stats: null });

    expect(target.textContent).toContain('統計情報はまだ読み込まれていません');
    expect(target.textContent).not.toContain('登録ユーザー累計（退会含む）');
  });
});
