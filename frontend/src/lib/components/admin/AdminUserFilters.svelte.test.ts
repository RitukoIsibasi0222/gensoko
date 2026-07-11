import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { mount, unmount } from '$lib/test/svelte-client';
import AdminUserFilters from './AdminUserFilters.svelte';
import type { AdminUserRole, AdminUserStatus } from '$lib/api/admin';

type FilterProps = {
  searchDraft: string;
  role?: AdminUserRole;
  status?: AdminUserStatus;
  isLoading?: boolean;
  onSearch: (q: string | undefined) => void;
  onRoleChange: (role: AdminUserRole | undefined) => void;
  onStatusChange: (status: AdminUserStatus | undefined) => void;
  onReset: () => void;
};

let mounted: ReturnType<typeof mount> | null = null;

function renderFilters(overrides: Partial<FilterProps> = {}): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: FilterProps = {
    searchDraft: '',
    onSearch: vi.fn(),
    onRoleChange: vi.fn(),
    onStatusChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides
  };
  mounted = mount(AdminUserFilters, { target, props });
  return target;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('AdminUserFilters', () => {
  it('検索・role・statusに明示的なlabelと選択肢を表示する', () => {
    const target = renderFilters();

    expect(target.querySelector('label[for=admin-user-search]')?.textContent).toContain(
      'ユーザー名またはメールアドレス'
    );
    expect(target.querySelector('label[for=admin-user-role]')?.textContent).toContain('ロール');
    expect(target.querySelector('label[for=admin-user-status]')?.textContent).toContain(
      'アカウント状態'
    );
    expect(target.textContent).toContain('すべてのロール');
    expect(target.textContent).toContain('停止中');
    expect(target.textContent).not.toContain('ログイン可能');
  });

  it('submit時に検索語を一度だけ正規化してonSearchへ渡す', () => {
    const onSearch = vi.fn();
    const target = renderFilters({ onSearch });
    const input = target.querySelector('#admin-user-search') as HTMLInputElement;
    const form = target.querySelector('form') as HTMLFormElement;

    setInputValue(input, '  taro@example.com  ');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(onSearch).toHaveBeenCalledWith('taro@example.com');
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('空白だけの検索はundefinedとして適用する', () => {
    const onSearch = vi.fn();
    const target = renderFilters({ onSearch });
    const input = target.querySelector('#admin-user-search') as HTMLInputElement;

    setInputValue(input, '   ');
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );

    expect(onSearch).toHaveBeenCalledWith(undefined);
  });

  it('101文字は画面内errorを表示して検索しない', async () => {
    const onSearch = vi.fn();
    const target = renderFilters({ onSearch });
    const input = target.querySelector('#admin-user-search') as HTMLInputElement;

    setInputValue(input, 'a'.repeat(101));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await tick();

    expect(target.querySelector('[role=alert]')?.textContent).toContain(
      '検索キーワードは100文字以内で入力してください'
    );
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('IME変換中のEnterではsubmitしない', () => {
    const onSearch = vi.fn();
    const target = renderFilters({ onSearch });
    const input = target.querySelector('#admin-user-search') as HTMLInputElement;
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true
    });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('role/status変更を型付きの値で通知する', () => {
    const onRoleChange = vi.fn();
    const onStatusChange = vi.fn();
    const target = renderFilters({ onRoleChange, onStatusChange });
    const roleSelect = target.querySelector('#admin-user-role') as HTMLSelectElement;
    const statusSelect = target.querySelector('#admin-user-status') as HTMLSelectElement;

    roleSelect.value = 'ADMIN';
    roleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    statusSelect.value = 'suspended';
    statusSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onRoleChange).toHaveBeenCalledWith('ADMIN');
    expect(onStatusChange).toHaveBeenCalledWith('suspended');
  });

  it('resetで入力errorを消し、親へ全条件リセットを通知する', async () => {
    const onReset = vi.fn();
    const target = renderFilters({ searchDraft: 'before', onReset });
    const input = target.querySelector('#admin-user-search') as HTMLInputElement;

    setInputValue(input, 'a'.repeat(101));
    (target.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await tick();
    const resetButton = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('条件をリセット')
    ) as HTMLButtonElement;
    resetButton.click();
    await tick();

    expect(input.value).toBe('');
    expect(target.querySelector('[role=alert]')).toBeNull();
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('読み込み中は検索・filter・resetの多重操作を防ぐ', () => {
    const target = renderFilters({ isLoading: true });

    const controls = Array.from(target.querySelectorAll('input, select, button')) as Array<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >;
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((control) => control.disabled)).toBe(true);
    expect(target.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
  });
});
