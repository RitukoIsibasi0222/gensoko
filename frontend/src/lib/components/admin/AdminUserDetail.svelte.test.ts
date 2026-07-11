import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount } from '$lib/test/svelte-client';
import AdminUserDetail from './AdminUserDetail.svelte';
import type { AdminUserDetail as AdminUserDetailData } from '$lib/api/admin';

const USER: AdminUserDetailData = {
  id: 'user-1',
  username: 'taro',
  email: 'taro@example.com',
  role: 'USER',
  emailVerified: true,
  isActive: true,
  deletedAt: null,
  loginFailCount: 0,
  lockedUntil: null,
  lastLoginAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-10T10:00:00.000Z',
  stats: {
    totalGames: 12,
    totalCorrect: 91,
    totalAnswered: 120,
    accuracyRate: 76,
    masteredCount: 18,
    currentStreak: 5,
    weeklyScore: 2400,
    allTimeScore: 9200,
    lastActiveDate: null,
    updatedAt: null
  }
};

type DetailAction = 'status' | 'role' | 'delete';

type DetailProps = {
  user: AdminUserDetailData | null;
  isLoading?: boolean;
  errorMessage?: string | null;
  currentUserId?: string;
  onRetry?: () => void;
  onAction: (user: AdminUserDetailData, action: DetailAction) => void;
};

let mounted: ReturnType<typeof mount> | null = null;

function renderDetail(overrides: Partial<DetailProps> = {}): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: DetailProps = {
    user: USER,
    onAction: vi.fn(),
    ...overrides
  };
  mounted = mount(AdminUserDetail, { target, props });
  return target;
}

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('AdminUserDetail', () => {
  it('email・account情報・詳細統計をlabel/valueで表示する', () => {
    const target = renderDetail();

    expect(target.querySelector('dl')).not.toBeNull();
    expect(target.textContent).toContain('taro@example.com');
    expect(target.textContent).toContain('累計ゲーム');
    expect(target.textContent).toContain('12');
    expect(target.textContent).toContain('正答率');
    expect(target.textContent).toContain('76%');
    expect(target.textContent).toContain('ログイン失敗回数');
  });

  it('nullable日付を未記録として表示する', () => {
    const target = renderDetail();

    expect(target.textContent).toContain('最終ログイン');
    expect(target.textContent).toContain('最終学習日');
    expect(target.textContent?.match(/未記録/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('loadingと部分error・retryを詳細領域内で表示する', () => {
    const loading = renderDetail({ user: null, isLoading: true });
    expect(loading.querySelector('[aria-live=polite]')?.textContent).toContain(
      'ユーザー詳細を読み込んでいます'
    );
  });

  it('error時に具体messageとretryを表示する', () => {
    const onRetry = vi.fn();
    const target = renderDetail({
      user: null,
      errorMessage: 'ユーザーが見つかりません',
      onRetry
    });
    const retryButton = target.querySelector('button') as HTMLButtonElement;

    expect(target.querySelector('[role=alert]')?.textContent).toContain('ユーザーが見つかりません');
    retryButton.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('停止・role変更・強制退会の導線を親へ通知する', () => {
    const onAction = vi.fn();
    const target = renderDetail({ onAction });
    const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>('button[data-action]'));

    buttons.find((button) => button.dataset.action === 'status')?.click();
    buttons.find((button) => button.dataset.action === 'role')?.click();
    buttons.find((button) => button.dataset.action === 'delete')?.click();

    expect(onAction.mock.calls).toEqual([
      [USER, 'status'],
      [USER, 'role'],
      [USER, 'delete']
    ]);
  });

  it('自分自身・退会済み・停止中role変更をdisabledにして理由を関連付ける', async () => {
    const selfTarget = renderDetail({ currentUserId: USER.id });
    const selfButtons = Array.from(
      selfTarget.querySelectorAll<HTMLButtonElement>('button[data-action]')
    );
    expect(selfButtons.every((button) => button.disabled)).toBe(true);
    expect(selfTarget.textContent).toContain('自分自身には管理操作を実行できません');

    await unmount(mounted!);
    mounted = null;
    document.body.replaceChildren();

    const suspendedTarget = renderDetail({
      user: { ...USER, isActive: false }
    });
    const roleButton = suspendedTarget.querySelector<HTMLButtonElement>(
      'button[data-action="role"]'
    );
    expect(roleButton?.disabled).toBe(true);
    expect(roleButton?.getAttribute('aria-describedby')).toBe('admin-detail-role-block-reason');
    expect(suspendedTarget.textContent).toContain('停止中のユーザーはロール変更できません');
  });
});
