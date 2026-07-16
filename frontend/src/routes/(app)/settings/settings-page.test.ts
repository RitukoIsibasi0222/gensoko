import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';
import { mount, tick, unmount } from '$lib/test/svelte-client';
import { STRONG_PASSWORD_73_BYTES } from '$lib/test/password-byte-boundary-fixtures';
import { PASSWORD_BYTE_LIMIT_HINT, PASSWORD_TOO_LONG_MESSAGE } from '$lib/validation/password';

const mocks = vi.hoisted(() => ({
  changeCurrentPassword: vi.fn(),
  deleteCurrentUser: vi.fn(),
  getCurrentUserProfile: vi.fn(),
  updateCurrentUsername: vi.fn(),
  goto: vi.fn(),
  logout: vi.fn(),
  updateUser: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastFromApiError: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/api/users', () => ({
  changeCurrentPassword: mocks.changeCurrentPassword,
  deleteCurrentUser: mocks.deleteCurrentUser,
  getCurrentUserProfile: mocks.getCurrentUserProfile,
  updateCurrentUsername: mocks.updateCurrentUsername
}));
vi.mock('$lib/stores/auth.svelte', () => ({
  authStore: {
    isInitializing: false,
    isLoggedIn: true,
    accessToken: 'access-token',
    logout: mocks.logout,
    updateUser: mocks.updateUser
  }
}));
vi.mock('$lib/stores/toast.svelte', () => ({
  toastStore: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    fromApiError: mocks.toastFromApiError
  }
}));

import SettingsPage from './+page.svelte';

let mounted: ReturnType<typeof mount> | null = null;

async function renderPage(): Promise<HTMLElement> {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(SettingsPage, { target });

  await vi.waitFor(() => {
    expect(mocks.getCurrentUserProfile).toHaveBeenCalledTimes(1);
  });
  await tick();

  return target;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submitPasswordForm(
  target: HTMLElement,
  values: { current: string; next: string; confirm: string }
): Promise<void> {
  const currentPasswordInput = target.querySelector('#current-password') as HTMLInputElement;
  const newPasswordInput = target.querySelector('#new-password') as HTMLInputElement;
  const confirmPasswordInput = target.querySelector('#confirm-password') as HTMLInputElement;
  const form = currentPasswordInput.closest('form') as HTMLFormElement;

  setInputValue(currentPasswordInput, values.current);
  setInputValue(newPasswordInput, values.next);
  setInputValue(confirmPasswordInput, values.confirm);
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await tick();
  await tick();
}

type DeleteFormControls = {
  currentPasswordInput: HTMLInputElement;
  acknowledgement: HTMLInputElement;
  form: HTMLFormElement;
  submitButton: HTMLButtonElement;
};

function getDeleteFormControls(target: HTMLElement): DeleteFormControls {
  const currentPasswordInput = target.querySelector('#delete-current-password') as HTMLInputElement;
  const form = currentPasswordInput.closest('form') as HTMLFormElement;

  return {
    currentPasswordInput,
    acknowledgement: form.querySelector('input[type="checkbox"]') as HTMLInputElement,
    form,
    submitButton: form.querySelector('button[type="submit"]') as HTMLButtonElement
  };
}

async function submitDeleteForm(
  target: HTMLElement,
  values: { currentPassword: string; acknowledged: boolean }
): Promise<DeleteFormControls> {
  const controls = getDeleteFormControls(target);
  setInputValue(controls.currentPasswordInput, values.currentPassword);
  controls.acknowledgement.checked = values.acknowledged;
  controls.acknowledgement.dispatchEvent(new Event('change', { bubbles: true }));
  controls.form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await tick();
  await tick();
  return controls;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUserProfile.mockResolvedValue({
    id: 'user-1',
    username: 'taro',
    email: 'taro@example.com',
    role: 'USER',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z'
  });
});

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('/settings password field error ownership', () => {
  it('新しいパスワードへ上限hintを常時関連付け、文字数maxlengthは設定しない', async () => {
    const target = await renderPage();
    const newPasswordInput = target.querySelector('#new-password') as HTMLInputElement;
    const hint = target.querySelector('#new-password-hint');

    expect(hint?.textContent).toContain(PASSWORD_BYTE_LIMIT_HINT);
    expect(newPasswordInput.getAttribute('aria-describedby')).toBe('new-password-hint');
    expect(newPasswordInput.hasAttribute('maxlength')).toBe(false);
  });

  it('assigns a 73-byte error only to the new password field', async () => {
    const target = await renderPage();
    await submitPasswordForm(target, {
      current: 'CurrentPass1!',
      next: STRONG_PASSWORD_73_BYTES,
      confirm: STRONG_PASSWORD_73_BYTES
    });

    const currentPasswordInput = target.querySelector('#current-password') as HTMLInputElement;
    const newPasswordInput = target.querySelector('#new-password') as HTMLInputElement;
    const confirmPasswordInput = target.querySelector('#confirm-password') as HTMLInputElement;

    expect(mocks.changeCurrentPassword).not.toHaveBeenCalled();
    expect(target.querySelector('#new-password-error')?.textContent).toContain(
      PASSWORD_TOO_LONG_MESSAGE
    );
    expect(newPasswordInput.getAttribute('aria-invalid')).toBe('true');
    expect(newPasswordInput.getAttribute('aria-describedby')).toBe(
      'new-password-hint new-password-error'
    );
    expect(document.activeElement).toBe(newPasswordInput);
    expect(currentPasswordInput.hasAttribute('aria-invalid')).toBe(false);
    expect(confirmPasswordInput.hasAttribute('aria-invalid')).toBe(false);
  });

  it('assigns an empty current-password error only to the current field', async () => {
    const target = await renderPage();
    await submitPasswordForm(target, {
      current: '',
      next: 'NewPassw0rd!',
      confirm: 'NewPassw0rd!'
    });

    const currentPasswordInput = target.querySelector('#current-password') as HTMLInputElement;
    const newPasswordInput = target.querySelector('#new-password') as HTMLInputElement;
    const confirmPasswordInput = target.querySelector('#confirm-password') as HTMLInputElement;

    expect(target.querySelector('#current-password-error')).not.toBeNull();
    expect(currentPasswordInput.getAttribute('aria-invalid')).toBe('true');
    expect(currentPasswordInput.getAttribute('aria-describedby')).toBe('current-password-error');
    expect(newPasswordInput.hasAttribute('aria-invalid')).toBe(false);
    expect(confirmPasswordInput.hasAttribute('aria-invalid')).toBe(false);
  });

  it('assigns a mismatch error only to the confirmation field', async () => {
    const target = await renderPage();
    await submitPasswordForm(target, {
      current: 'CurrentPass1!',
      next: 'NewPassw0rd!',
      confirm: 'Different1!'
    });

    const currentPasswordInput = target.querySelector('#current-password') as HTMLInputElement;
    const newPasswordInput = target.querySelector('#new-password') as HTMLInputElement;
    const confirmPasswordInput = target.querySelector('#confirm-password') as HTMLInputElement;

    expect(target.querySelector('#confirm-password-error')).not.toBeNull();
    expect(confirmPasswordInput.getAttribute('aria-invalid')).toBe('true');
    expect(confirmPasswordInput.getAttribute('aria-describedby')).toBe('confirm-password-error');
    expect(currentPasswordInput.hasAttribute('aria-invalid')).toBe(false);
    expect(newPasswordInput.hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('/settings existing-password compatibility', () => {
  it('sends the complete 73-byte current password when changing password', async () => {
    mocks.changeCurrentPassword.mockResolvedValue(undefined);
    const target = await renderPage();

    await submitPasswordForm(target, {
      current: STRONG_PASSWORD_73_BYTES,
      next: 'NewPassw0rd!',
      confirm: 'NewPassw0rd!'
    });

    await vi.waitFor(() => {
      expect(mocks.changeCurrentPassword).toHaveBeenCalledTimes(1);
    });
    expect(mocks.changeCurrentPassword).toHaveBeenCalledWith({
      accessToken: 'access-token',
      currentPassword: STRONG_PASSWORD_73_BYTES,
      newPassword: 'NewPassw0rd!'
    });
    const currentPasswordInput = target.querySelector('#current-password') as HTMLInputElement;
    expect(currentPasswordInput.hasAttribute('maxlength')).toBe(false);
  });

  it('sends the complete 73-byte current password when deleting the account', async () => {
    mocks.deleteCurrentUser.mockResolvedValue(undefined);
    const target = await renderPage();
    const { currentPasswordInput } = await submitDeleteForm(target, {
      currentPassword: STRONG_PASSWORD_73_BYTES,
      acknowledged: true
    });

    await vi.waitFor(() => {
      expect(mocks.deleteCurrentUser).toHaveBeenCalledTimes(1);
    });
    expect(mocks.deleteCurrentUser).toHaveBeenCalledWith({
      accessToken: 'access-token',
      currentPassword: STRONG_PASSWORD_73_BYTES
    });
    expect(currentPasswordInput.hasAttribute('maxlength')).toBe(false);
  });
});

describe('/settings account deletion A11Y contract', () => {
  it('稼働DBのprofile・auth・learning dataを取り消せず削除する警告を表示する', async () => {
    const target = await renderPage();
    const warning = target.querySelector('#delete-warning')?.textContent ?? '';

    expect(warning).toContain('稼働DB');
    expect(warning).toContain('プロフィール');
    expect(warning).toContain('認証情報');
    expect(warning).toContain('学習データ');
    expect(warning).toContain('取り消せません');
  });

  it('password空欄はpasswordだけをinvalidにしてpasswordへfocusする', async () => {
    const target = await renderPage();
    const controls = await submitDeleteForm(target, {
      currentPassword: '',
      acknowledged: true
    });

    expect(target.querySelector('#delete-current-password-error')?.textContent ?? '').toContain(
      '現在のパスワードを入力してください'
    );
    expect(controls.currentPasswordInput.getAttribute('aria-invalid')).toBe('true');
    expect(controls.currentPasswordInput.getAttribute('aria-describedby')).toBe(
      'delete-current-password-error'
    );
    expect(controls.acknowledgement.hasAttribute('aria-invalid')).toBe(false);
    expect(controls.acknowledgement.getAttribute('aria-describedby')).toBe('delete-warning');
    expect(document.activeElement).toBe(controls.currentPasswordInput);
  });

  it('同意なしはcheckboxだけをinvalidにしてwarning・errorを関連付けてfocusする', async () => {
    const target = await renderPage();
    const controls = await submitDeleteForm(target, {
      currentPassword: 'CurrentPass1!',
      acknowledged: false
    });

    expect(target.querySelector('#delete-acknowledgement-error')?.textContent ?? '').toContain(
      'アカウント削除の確認チェックを入れてください'
    );
    expect(controls.currentPasswordInput.hasAttribute('aria-invalid')).toBe(false);
    expect(controls.acknowledgement.getAttribute('aria-invalid')).toBe('true');
    expect(controls.acknowledgement.getAttribute('aria-describedby')).toBe(
      'delete-warning delete-acknowledgement-error'
    );
    expect(document.activeElement).toBe(controls.acknowledgement);
  });

  it('passwordと同意が両方invalidなら各errorを表示して最初のpasswordへfocusする', async () => {
    const target = await renderPage();
    const controls = await submitDeleteForm(target, {
      currentPassword: '',
      acknowledged: false
    });

    expect(target.querySelector('#delete-current-password-error')).not.toBeNull();
    expect(target.querySelector('#delete-acknowledgement-error')).not.toBeNull();
    expect(controls.currentPasswordInput.getAttribute('aria-invalid')).toBe('true');
    expect(controls.acknowledgement.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(controls.currentPasswordInput);
  });

  it.each([
    { status: 400, message: '現在のパスワードが正しくありません' },
    { status: 409, message: '同時操作により処理できませんでした。再試行してください' },
    {
      status: 429,
      message: 'リクエストが多すぎます。しばらく待ってから再試行してください'
    },
    { status: 503, message: 'サービスを一時的に利用できません' }
  ])('API $statusの具体的な日本語messageをalertで保持する', async ({ status, message }) => {
    const error = new ApiError(status, message);
    mocks.deleteCurrentUser.mockRejectedValue(error);
    const target = await renderPage();

    const controls = await submitDeleteForm(target, {
      currentPassword: 'CurrentPass1!',
      acknowledged: true
    });

    const alert = controls.form.querySelector('[role="alert"]');
    expect(alert?.textContent ?? '').toContain(message);
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(mocks.toastFromApiError).toHaveBeenCalledWith(error);
  });

  it('network errorは接続確認の共通messageをalertで表示する', async () => {
    mocks.deleteCurrentUser.mockRejectedValue(new TypeError('Failed to fetch'));
    const target = await renderPage();

    const controls = await submitDeleteForm(target, {
      currentPassword: 'CurrentPass1!',
      acknowledged: true
    });

    const alert = controls.form.querySelector('[role="alert"]');
    expect(alert?.textContent ?? '').toContain(
      'ネットワークエラーが発生しました。接続を確認してください'
    );
    expect(alert?.getAttribute('role')).toBe('alert');
  });

  it('送信中はformをbusyにしてbuttonを無効化し二重submitを防ぐ', async () => {
    let resolveDelete!: (value: unknown) => void;
    mocks.deleteCurrentUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        })
    );
    const target = await renderPage();
    const controls = await submitDeleteForm(target, {
      currentPassword: 'CurrentPass1!',
      acknowledged: true
    });

    expect(controls.form.getAttribute('aria-busy')).toBe('true');
    expect(controls.submitButton.disabled).toBe(true);
    controls.form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await tick();
    expect(mocks.deleteCurrentUser).toHaveBeenCalledTimes(1);

    resolveDelete(undefined);
    await vi.waitFor(() => {
      expect(mocks.goto).toHaveBeenCalledWith('/');
    });
  });

  it('AbortErrorは削除失敗と断定せず再ログインでの状態確認を案内する', async () => {
    mocks.deleteCurrentUser.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const target = await renderPage();

    const controls = await submitDeleteForm(target, {
      currentPassword: 'CurrentPass1!',
      acknowledged: true
    });

    const message = controls.form.querySelector('[role="alert"]')?.textContent ?? '';
    expect(message).toContain('削除結果を確認できませんでした');
    expect(message).toContain('再ログイン');
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('page破棄時はdelete requestへ渡したsignalをabortする', async () => {
    let capturedSignal: AbortSignal | undefined;
    mocks.deleteCurrentUser.mockImplementation(
      (options: { signal?: AbortSignal }) =>
        new Promise(() => {
          capturedSignal = options.signal;
        })
    );
    const target = await renderPage();

    await submitDeleteForm(target, {
      currentPassword: 'CurrentPass1!',
      acknowledged: true
    });
    await vi.waitFor(() => {
      expect(mocks.deleteCurrentUser).toHaveBeenCalledTimes(1);
    });

    await unmount(mounted!);
    mounted = null;

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(true);
  });
});
