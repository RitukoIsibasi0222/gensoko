import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from '$lib/test/svelte-client';
import AdminActionConfirmation from './AdminActionConfirmation.svelte';
import type { AdminUserSummary } from '$lib/api/admin';

const USER: AdminUserSummary = {
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
  updatedAt: '2026-07-10T10:00:00.000Z'
};

type ConfirmationAction =
  | { type: 'status'; nextIsActive: boolean }
  | { type: 'role'; nextRole: 'USER' | 'ADMIN' }
  | { type: 'delete' };

type ConfirmationProps = {
  user: AdminUserSummary;
  action: ConfirmationAction;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

let mounted: ReturnType<typeof mount> | null = null;

function renderConfirmation(
  action: ConfirmationAction,
  overrides: Partial<ConfirmationProps> = {}
): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const props: ConfirmationProps = {
    user: USER,
    action,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  };
  mounted = mount(AdminActionConfirmation, { target, props });
  return target;
}

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('AdminActionConfirmation', () => {
  it('停止・解除の対象とbefore/afterを表示する', () => {
    const target = renderConfirmation({ type: 'status', nextIsActive: false });

    expect(target.textContent).toContain('taro');
    expect(target.textContent).toContain('有効（未退会）');
    expect(target.textContent).toContain('停止中');
  });

  it('role変更の現在値と変更後を表示する', () => {
    const target = renderConfirmation({ type: 'role', nextRole: 'ADMIN' });

    expect(target.textContent).toContain('USER');
    expect(target.textContent).toContain('ADMIN');
    expect(target.textContent).toContain('ロールを変更');
  });

  it('強制退会は固定語が完全一致するまでconfirmを無効化する', async () => {
    const onConfirm = vi.fn();
    const target = renderConfirmation({ type: 'delete' }, { onConfirm });
    const input = target.querySelector('input') as HTMLInputElement;
    const confirmButton = target.querySelector('[data-confirm]') as HTMLButtonElement;

    expect(target.textContent).toContain('この管理画面から元に戻せません');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(confirmButton.disabled).toBe(true);

    input.value = '強制退会';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    expect(confirmButton.disabled).toBe(false);
    confirmButton.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancelはconfirmを実行せず親へ通知する', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const target = renderConfirmation(
      { type: 'status', nextIsActive: false },
      { onConfirm, onCancel }
    );
    const cancelButton = target.querySelector('[data-cancel]') as HTMLButtonElement;

    cancelButton.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('送信中はaria-busyを通知しcancel・confirm・入力を無効化する', () => {
    const target = renderConfirmation({ type: 'delete' }, { isSubmitting: true });
    const controls = Array.from(target.querySelectorAll('input, button')) as Array<
      HTMLInputElement | HTMLButtonElement
    >;

    expect(target.querySelector('[data-confirmation]')?.getAttribute('aria-busy')).toBe('true');
    expect(controls.every((control) => control.disabled)).toBe(true);
  });

  it('409等の具体的なerrorをalertで保持する', () => {
    const target = renderConfirmation(
      { type: 'role', nextRole: 'ADMIN' },
      { errorMessage: '最後の管理者は変更できません' }
    );

    expect(target.querySelector('[role=alert]')?.textContent).toContain(
      '最後の管理者は変更できません'
    );
  });
});
