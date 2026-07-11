import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount } from '$lib/test/svelte-client';
import AdminUserList from './AdminUserList.svelte';
import type { AdminUserListItem } from '$lib/api/admin';

const USERS: AdminUserListItem[] = [
  {
    id: 'user-1',
    username: 'taro',
    email: 'taro@example.com',
    role: 'USER',
    emailVerified: true,
    isActive: true,
    deletedAt: null,
    lockedUntil: null,
    lastLoginAt: '2026-07-10T10:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
    stats: {
      totalGames: 12,
      accuracyRate: 75,
      weeklyScore: 2400,
      allTimeScore: 9200
    }
  },
  {
    id: 'user-2',
    username: 'hanako',
    email: 'hanako@example.com',
    role: 'ADMIN',
    emailVerified: false,
    isActive: false,
    deletedAt: null,
    lockedUntil: '2099-07-10T10:00:00.000Z',
    lastLoginAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
    stats: {
      totalGames: 0,
      accuracyRate: 0,
      weeklyScore: 0,
      allTimeScore: 0
    }
  },
  {
    id: 'user-3',
    username: 'deleted-user',
    email: 'deleted@example.com',
    role: 'USER',
    emailVerified: true,
    isActive: false,
    deletedAt: '2026-07-09T00:00:00.000Z',
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
    stats: {
      totalGames: 4,
      accuracyRate: 50,
      weeklyScore: 0,
      allTimeScore: 300
    }
  }
];

type AdminListAction = 'status' | 'role' | 'delete';

type ListProps = {
  users: AdminUserListItem[];
  currentUserId?: string;
  nextCursor: string | null;
  isLoading?: boolean;
  isPageLoading?: boolean;
  paginationError?: string | null;
  onViewDetail: (user: AdminUserListItem, trigger: HTMLElement) => void;
  onAction: (user: AdminUserListItem, action: AdminListAction, trigger: HTMLElement) => void;
  onLoadNext: () => void;
  onReturnToFirst?: () => void;
  onResetFilters?: () => void;
};

let mounted: ReturnType<typeof mount> | null = null;

function renderList(overrides: Partial<ListProps> = {}): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: ListProps = {
    users: USERS,
    nextCursor: 'user-3',
    onViewDetail: vi.fn(),
    onAction: vi.fn(),
    onLoadNext: vi.fn(),
    ...overrides
  };
  mounted = mount(AdminUserList, { target, props });
  return target;
}

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('AdminUserList', () => {
  it('desktop tableにcaption、見出し、scopeを設定しemailを常時表示しない', () => {
    const target = renderList();
    const table = target.querySelector('table');

    expect(target.querySelector('#admin-user-list-heading')?.textContent).toContain('ユーザー一覧');
    expect(table?.querySelector('caption')?.textContent).toContain('管理対象ユーザー');
    expect(table?.querySelectorAll('th[scope=col]').length).toBeGreaterThan(0);
    expect(table?.querySelector('tbody th[scope=row]')?.textContent).toContain('taro');
    expect(target.textContent).not.toContain('taro@example.com');
    expect(target.textContent).not.toContain('hanako@example.com');
  });

  it('mobile listをulとdlのlabel/value対応で表示する', () => {
    const target = renderList();
    const mobileList = target.querySelector('[data-mobile-admin-list]');

    expect(mobileList?.tagName).toBe('UL');
    expect(mobileList?.querySelectorAll('li').length).toBe(USERS.length);
    expect(mobileList?.querySelector('dl')).not.toBeNull();
    expect(mobileList?.textContent).toContain('ロール');
    expect(mobileList?.textContent).toContain('ゲーム回数');
  });

  it('account状態・メール確認・lockを色だけに依存せず別々に表示する', () => {
    const target = renderList();

    expect(target.textContent).toContain('有効（未退会）');
    expect(target.textContent).toContain('停止中');
    expect(target.textContent).toContain('退会済み');
    expect(target.textContent).toContain('メール確認済み');
    expect(target.textContent).toContain('メール未確認');
    expect(target.textContent).toContain('ロック中');
    expect(target.textContent).not.toContain('ログイン可能');
  });

  it('行操作のaccessible nameにusernameと操作内容を含めemailを含めない', () => {
    const onViewDetail = vi.fn();
    const onAction = vi.fn();
    const target = renderList({ users: [USERS[0]], onViewDetail, onAction });
    const detailButton = target.querySelector(
      'button[aria-label="taroの詳細を表示"]'
    ) as HTMLButtonElement;
    const statusButton = target.querySelector(
      'button[aria-label="taroのアカウントを停止"]'
    ) as HTMLButtonElement;

    detailButton.click();
    statusButton.click();

    expect(detailButton.getAttribute('aria-label')).not.toContain('example.com');
    expect(onViewDetail).toHaveBeenCalledWith(USERS[0], detailButton);
    expect(onAction).toHaveBeenCalledWith(USERS[0], 'status', statusButton);
  });

  it('自分自身と退会済みユーザーの管理操作をdisabledにして理由を表示する', () => {
    const target = renderList({ currentUserId: 'user-1' });
    const selfCard = target.querySelector('[data-user-id="user-1"]') as HTMLElement;
    const deletedCard = target.querySelector('[data-user-id="user-3"]') as HTMLElement;

    expect(
      Array.from(selfCard.querySelectorAll<HTMLButtonElement>('button[data-admin-action]')).every(
        (button) => button.disabled
      )
    ).toBe(true);
    expect(selfCard.textContent).toContain('自分自身には管理操作を実行できません');
    expect(
      Array.from(
        deletedCard.querySelectorAll<HTMLButtonElement>('button[data-admin-action]')
      ).every((button) => button.disabled)
    ).toBe(true);
    expect(deletedCard.textContent).toContain('退会済みユーザーは変更できません');
  });

  it('初期loadingをaria-busyとlive regionで通知する', () => {
    const target = renderList({ users: [], isLoading: true, nextCursor: null });

    expect(target.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
    expect(target.querySelector('[aria-live=polite]')?.textContent).toContain(
      'ユーザー一覧を読み込んでいます'
    );
  });

  it('空状態に条件付き文言とfilter reset導線を表示する', () => {
    const onResetFilters = vi.fn();
    const target = renderList({
      users: [],
      nextCursor: null,
      onResetFilters
    });
    const resetButton = target.querySelector('button') as HTMLButtonElement;

    expect(target.textContent).toContain('条件に一致するユーザーはいません');
    expect(resetButton.textContent).toContain('条件をリセット');
    resetButton.click();
    expect(onResetFilters).toHaveBeenCalledTimes(1);
  });

  it('nextCursorがある場合だけ次ページ導線を表示する', () => {
    const onLoadNext = vi.fn();
    const withNext = renderList({ onLoadNext });
    const nextButton = Array.from(withNext.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('次を読み込む')
    ) as HTMLButtonElement;

    nextButton.click();
    expect(onLoadNext).toHaveBeenCalledTimes(1);
  });

  it('nextCursorがなければ行を表示したまま次ページ導線を出さない', () => {
    const target = renderList({ nextCursor: null });

    expect(target.textContent).toContain('taro');
    expect(
      Array.from(target.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('次を読み込む')
      )
    ).toBe(false);
  });

  it('次ページloading中も現在行を保持し、二重実行を防ぐ', () => {
    const target = renderList({ isPageLoading: true });
    const nextButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('読み込み中')
    ) as HTMLButtonElement;

    expect(target.textContent).toContain('taro');
    expect(nextButton.disabled).toBe(true);
    expect(target.querySelector('[aria-live=polite]')?.textContent).toContain(
      '次のユーザーを読み込んでいます'
    );
  });

  it('次ページerrorでも現在行を保持し、inline retryを提供する', () => {
    const onLoadNext = vi.fn();
    const onReturnToFirst = vi.fn();
    const target = renderList({
      paginationError: 'カーソルが正しくありません',
      onLoadNext,
      onReturnToFirst
    });
    const alert = target.querySelector('[role=alert]');
    const retryButton = Array.from(alert?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('再試行')
    ) as HTMLButtonElement;
    const firstPageButton = Array.from(alert?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('一覧の先頭へ戻る')
    ) as HTMLButtonElement;

    expect(target.textContent).toContain('taro');
    expect(alert?.textContent).toContain('カーソルが正しくありません');
    retryButton.click();
    firstPageButton.click();
    expect(onLoadNext).toHaveBeenCalledTimes(1);
    expect(onReturnToFirst).toHaveBeenCalledTimes(1);
  });
});
