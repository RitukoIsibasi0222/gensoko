import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from '$lib/test/svelte-client';
import { ApiError } from '$lib/api/errors';
import type { AdminStats, AdminUserDetail, AdminUserListItem } from '$lib/api/admin';

const mocks = vi.hoisted(() => ({
  auth: {
    status: 'authenticated' as 'initializing' | 'authenticated' | 'anonymous',
    user: { id: 'admin-1', username: 'admin', role: 'ADMIN' as 'USER' | 'ADMIN' } as {
      id: string;
      username: string;
      role: 'USER' | 'ADMIN';
    } | null,
    accessToken: 'old-token' as string | null
  },
  refresh: vi.fn<() => Promise<boolean>>(),
  updateUser: vi.fn(),
  getAdminUsers: vi.fn(),
  getAdminStats: vi.fn(),
  getAdminUserDetail: vi.fn(),
  updateAdminUserStatus: vi.fn(),
  updateAdminUserRole: vi.fn(),
  deleteAdminUser: vi.fn(),
  goto: vi.fn(),
  page: { url: new URL('http://localhost/admin'), state: {} as Record<string, unknown> }
}));

vi.mock('$lib/stores/auth.svelte', () => ({
  authStore: {
    get isInitializing() {
      return mocks.auth.status === 'initializing';
    },
    get isLoggedIn() {
      return mocks.auth.status === 'authenticated';
    },
    get user() {
      return mocks.auth.user;
    },
    get accessToken() {
      return mocks.auth.accessToken;
    },
    refresh: mocks.refresh,
    updateUser: mocks.updateUser
  }
}));
vi.mock('$lib/api/admin', () => ({
  getAdminUsers: mocks.getAdminUsers,
  getAdminStats: mocks.getAdminStats,
  getAdminUserDetail: mocks.getAdminUserDetail,
  updateAdminUserStatus: mocks.updateAdminUserStatus,
  updateAdminUserRole: mocks.updateAdminUserRole,
  deleteAdminUser: mocks.deleteAdminUser
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

import AdminPage from './+page.svelte';

const TARO: AdminUserListItem = {
  id: 'user-1',
  username: 'taro',
  email: 'taro@example.com',
  role: 'USER',
  emailVerified: true,
  isActive: true,
  deletedAt: null,
  lockedUntil: null,
  lastLoginAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-10T10:00:00.000Z',
  stats: { totalGames: 12, accuracyRate: 80, weeklyScore: 120, allTimeScore: 900 }
};
const HANAKO: AdminUserListItem = {
  ...TARO,
  id: 'user-2',
  username: 'hanako',
  email: 'hanako@example.com',
  role: 'ADMIN'
};
const USERS = [TARO, HANAKO];
const STATS: AdminStats = {
  users: { total: 10, active: 8, suspended: 1, deleted: 1, admins: 2, emailVerified: 8 },
  games: { totalSessions: 100, totalAnswered: 1000, averageAccuracyRate: 85 },
  learning: { totalWeakElements: 20, totalMasteredCount: 200 }
};

function createDetail(user: AdminUserListItem): AdminUserDetail {
  return {
    ...user,
    loginFailCount: 0,
    stats: {
      totalGames: user.stats.totalGames,
      totalCorrect: 80,
      totalAnswered: 100,
      accuracyRate: user.stats.accuracyRate,
      masteredCount: 15,
      currentStreak: 3,
      weeklyScore: user.stats.weeklyScore,
      allTimeScore: user.stats.allTimeScore,
      lastActiveDate: null,
      updatedAt: null
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushAsyncWork(): Promise<void> {
  for (let count = 0; count < 6; count += 1) {
    await Promise.resolve();
    await tick();
  }
}

let mounted: ReturnType<typeof mount> | null = null;

function renderPage(): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(AdminPage, { target });
  return target;
}

beforeEach(() => {
  mocks.auth.status = 'authenticated';
  mocks.auth.user = { id: 'admin-1', username: 'admin', role: 'ADMIN' };
  mocks.auth.accessToken = 'old-token';
  mocks.page.url = new URL('http://localhost/admin');
  mocks.page.state = {};
  vi.clearAllMocks();
  mocks.refresh.mockImplementation(async () => {
    mocks.auth.accessToken = 'new-token';
    return true;
  });
  mocks.updateUser.mockImplementation((user) => {
    mocks.auth.user = user;
  });
  mocks.getAdminUsers.mockResolvedValue({ users: USERS, nextCursor: null });
  mocks.getAdminStats.mockResolvedValue(STATS);
  mocks.getAdminUserDetail.mockImplementation(async ({ userId }: { userId: string }) => ({
    user: createDetail(USERS.find((user) => user.id === userId) ?? TARO)
  }));
  mocks.updateAdminUserStatus.mockResolvedValue({
    message: 'アカウントを停止しました',
    user: { ...TARO, isActive: false }
  });
  mocks.updateAdminUserRole.mockResolvedValue({
    message: 'ロールを変更しました',
    user: { ...TARO, role: 'ADMIN' }
  });
  mocks.deleteAdminUser.mockResolvedValue({ message: 'ユーザーを強制退会しました' });
});

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('/admin auth・authz・read orchestration', () => {
  it('認証初期化中はbusy表示だけを出し、管理APIを呼ばない', async () => {
    mocks.auth.status = 'initializing';
    const target = renderPage();
    await flushAsyncWork();

    expect(target.querySelector('[aria-busy=true]')?.textContent).toContain(
      'ログイン状態を確認しています'
    );
    expect(target.textContent).not.toContain('ユーザー一覧');
    expect(mocks.getAdminUsers).not.toHaveBeenCalled();
  });

  it('未ログイン時は管理APIを呼ばずlogin導線を表示する', async () => {
    mocks.auth.status = 'anonymous';
    mocks.auth.user = null;
    mocks.auth.accessToken = null;
    const target = renderPage();
    await flushAsyncWork();

    expect(target.textContent).toContain('ログインが必要です');
    expect(target.querySelector('a[href="/login"]')).not.toBeNull();
    expect(mocks.getAdminUsers).not.toHaveBeenCalled();
  });

  it('local USERでもlist 200を認可根拠としてcontentを表示しroleを同期する', async () => {
    mocks.auth.user = { id: 'admin-1', username: 'admin', role: 'USER' };
    const target = renderPage();
    await flushAsyncWork();

    expect(mocks.getAdminUsers).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'old-token', query: { limit: 20 } })
    );
    expect(target.textContent).toContain('管理者ダッシュボード');
    expect(target.textContent).toContain('ユーザー一覧');
    expect(mocks.getAdminStats).toHaveBeenCalledTimes(1);
    expect(mocks.updateUser).toHaveBeenCalledWith({
      id: 'admin-1',
      username: 'admin',
      role: 'ADMIN'
    });
  });

  it('list 403は具体messageを保持してfail-closedにし、statsを開始しない', async () => {
    mocks.getAdminUsers.mockRejectedValue(new ApiError(403, '管理者権限が必要です'));
    const target = renderPage();
    await flushAsyncWork();

    expect(target.querySelector('[role=alert]')?.textContent).toContain('管理者権限が必要です');
    expect(target.textContent).not.toContain('ユーザー一覧');
    expect(mocks.getAdminStats).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('list 401はrefresh後の最新tokenで1回だけretryする', async () => {
    mocks.getAdminUsers
      .mockRejectedValueOnce(new ApiError(401, '認証が必要です'))
      .mockResolvedValueOnce({ users: USERS, nextCursor: null });
    renderPage();
    await flushAsyncWork();

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.getAdminUsers).toHaveBeenCalledTimes(2);
    expect(mocks.getAdminUsers.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ accessToken: 'old-token' })
    );
    expect(mocks.getAdminUsers.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ accessToken: 'new-token' })
    );
  });

  it('retry後も401なら無限retryせずlogin導線へ遷移する', async () => {
    mocks.getAdminUsers.mockRejectedValue(new ApiError(401, '認証が必要です'));
    const target = renderPage();
    await flushAsyncWork();

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.getAdminUsers).toHaveBeenCalledTimes(2);
    expect(target.textContent).toContain('ログインが必要です');
  });

  it('statsとdetailの401が重なってもrefreshをsingle-flightにする', async () => {
    const refreshGate = deferred<boolean>();
    mocks.refresh.mockImplementation(() => refreshGate.promise);
    mocks.getAdminStats
      .mockRejectedValueOnce(new ApiError(401, '認証が必要です'))
      .mockResolvedValueOnce(STATS);
    mocks.getAdminUserDetail
      .mockRejectedValueOnce(new ApiError(401, '認証が必要です'))
      .mockResolvedValueOnce({ user: createDetail(TARO) });

    const target = renderPage();
    await flushAsyncWork();
    target.querySelector<HTMLButtonElement>('button[aria-label="taroの詳細を表示"]')?.click();
    await flushAsyncWork();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    mocks.auth.accessToken = 'shared-token';
    refreshGate.resolve(true);
    await flushAsyncWork();

    expect(mocks.getAdminStats).toHaveBeenCalledTimes(2);
    expect(mocks.getAdminUserDetail).toHaveBeenCalledTimes(2);
    expect(mocks.getAdminStats.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ accessToken: 'shared-token' })
    );
    expect(mocks.getAdminUserDetail.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ accessToken: 'shared-token' })
    );
  });

  it('遅れて完了した古いdetail responseで最新dialogを上書きしない', async () => {
    const firstDetail = deferred<{ user: AdminUserDetail }>();
    const secondDetail = deferred<{ user: AdminUserDetail }>();
    mocks.getAdminUserDetail.mockImplementation(({ userId }: { userId: string }) =>
      userId === 'user-1' ? firstDetail.promise : secondDetail.promise
    );
    const target = renderPage();
    await flushAsyncWork();

    target.querySelector<HTMLButtonElement>('button[aria-label="taroの詳細を表示"]')?.click();
    await flushAsyncWork();
    target.querySelector<HTMLButtonElement>('button[aria-label="hanakoの詳細を表示"]')?.click();
    await flushAsyncWork();

    secondDetail.resolve({ user: createDetail(HANAKO) });
    await flushAsyncWork();
    expect(target.textContent).toContain('hanako@example.com');

    firstDetail.resolve({ user: createDetail(TARO) });
    await flushAsyncWork();
    expect(target.textContent).toContain('hanako@example.com');
    expect(target.textContent).not.toContain('taro@example.com');
  });
});

describe('/admin mutation・sync orchestration', () => {
  it('停止操作は対象とbefore/afterを確認して正しいPATCH引数を送る', async () => {
    const target = renderPage();
    await flushAsyncWork();

    target.querySelector<HTMLButtonElement>('button[aria-label="taroのアカウントを停止"]')?.click();
    await flushAsyncWork();

    expect(target.textContent).toContain('有効（未退会）');
    expect(target.textContent).toContain('停止中');
    target.querySelector<HTMLButtonElement>('[data-confirm]')?.click();
    await flushAsyncWork();

    expect(mocks.updateAdminUserStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'old-token',
        userId: 'user-1',
        isActive: false
      })
    );
  });

  it('USERからADMINへの変更方向を確認して正しいrole PATCHを送る', async () => {
    const target = renderPage();
    await flushAsyncWork();

    target
      .querySelector<HTMLButtonElement>('button[aria-label="taroのロールをADMINに変更"]')
      ?.click();
    await flushAsyncWork();

    expect(target.textContent).toContain('USER');
    expect(target.textContent).toContain('ADMIN');
    target.querySelector<HTMLButtonElement>('[data-confirm]')?.click();
    await flushAsyncWork();

    expect(mocks.updateAdminUserRole).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'old-token',
        userId: 'user-1',
        role: 'ADMIN'
      })
    );
  });

  it('強制退会は固定語が一致するまで無効で、一致後にDELETEを送る', async () => {
    const target = renderPage();
    await flushAsyncWork();

    target.querySelector<HTMLButtonElement>('button[aria-label="taroを強制退会"]')?.click();
    await flushAsyncWork();

    const input = target.querySelector<HTMLInputElement>('#admin-force-delete-confirmation');
    const confirmButton = target.querySelector<HTMLButtonElement>('[data-confirm]');
    expect(confirmButton?.disabled).toBe(true);

    if (input) {
      input.value = '強制退会';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await tick();
    expect(confirmButton?.disabled).toBe(false);
    confirmButton?.click();
    await flushAsyncWork();

    expect(mocks.deleteAdminUser).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'old-token', userId: 'user-1' })
    );
  });

  it('確認dialogをcancelした場合はmutation APIを呼ばない', async () => {
    const target = renderPage();
    await flushAsyncWork();

    target.querySelector<HTMLButtonElement>('button[aria-label="taroのアカウントを停止"]')?.click();
    await flushAsyncWork();
    expect(target.querySelector('[role=dialog]')).not.toBeNull();
    target.querySelector<HTMLButtonElement>('[data-cancel]')?.click();
    await flushAsyncWork();

    expect(mocks.updateAdminUserStatus).not.toHaveBeenCalled();
    expect(mocks.updateAdminUserRole).not.toHaveBeenCalled();
    expect(mocks.deleteAdminUser).not.toHaveBeenCalled();
    expect(target.querySelector('[role=dialog]')).toBeNull();
  });

  it('送信中のdouble clickでもmutationは1回だけ実行する', async () => {
    const mutationGate = deferred<{
      message: string;
      user: AdminUserListItem;
    }>();
    mocks.updateAdminUserStatus.mockImplementation(() => mutationGate.promise);
    const target = renderPage();
    await flushAsyncWork();

    target.querySelector<HTMLButtonElement>('button[aria-label="taroのアカウントを停止"]')?.click();
    await flushAsyncWork();
    const confirmButton = target.querySelector<HTMLButtonElement>('[data-confirm]');
    confirmButton?.click();
    confirmButton?.click();
    await flushAsyncWork();

    expect(mocks.updateAdminUserStatus).toHaveBeenCalledTimes(1);
    expect(target.querySelector('[role=dialog]')?.getAttribute('aria-busy')).toBe('true');

    mutationGate.resolve({
      message: 'アカウントを停止しました',
      user: { ...TARO, isActive: false }
    });
    await flushAsyncWork();
  });

  it('409の具体messageをdialog内に保持し、mutationを再送しない', async () => {
    mocks.updateAdminUserRole.mockRejectedValue(new ApiError(409, '最後の管理者は変更できません'));
    const target = renderPage();
    await flushAsyncWork();

    target
      .querySelector<HTMLButtonElement>('button[aria-label="taroのロールをADMINに変更"]')
      ?.click();
    await flushAsyncWork();
    target.querySelector<HTMLButtonElement>('[data-confirm]')?.click();
    await flushAsyncWork();

    expect(target.querySelector('[role=dialog] [role=alert]')?.textContent).toContain(
      '最後の管理者は変更できません'
    );
    expect(mocks.updateAdminUserRole).toHaveBeenCalledTimes(1);
    expect(mocks.getAdminUsers).toHaveBeenCalledTimes(1);
  });

  it('成功後は最新条件でlist・stats・開いているdetailを再取得する', async () => {
    const target = renderPage();
    await flushAsyncWork();

    target.querySelector<HTMLButtonElement>('button[aria-label="taroの詳細を表示"]')?.click();
    await flushAsyncWork();
    expect(mocks.getAdminUserDetail).toHaveBeenCalledTimes(1);

    target.querySelector<HTMLButtonElement>('[role=dialog] button[data-action="status"]')?.click();
    await flushAsyncWork();
    target.querySelector<HTMLButtonElement>('[data-confirm]')?.click();
    await flushAsyncWork();

    expect(mocks.updateAdminUserStatus).toHaveBeenCalledTimes(1);
    expect(mocks.getAdminUsers).toHaveBeenCalledTimes(2);
    expect(mocks.getAdminStats).toHaveBeenCalledTimes(2);
    expect(mocks.getAdminUserDetail).toHaveBeenCalledTimes(2);
    expect(target.querySelector('[aria-live=polite]')?.textContent).toContain(
      'アカウントを停止しました'
    );
  });
});
