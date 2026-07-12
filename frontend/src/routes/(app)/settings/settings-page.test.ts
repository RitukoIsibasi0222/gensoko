import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    const currentPasswordInput = target.querySelector(
      '#delete-current-password'
    ) as HTMLInputElement;
    const acknowledgement = target.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const form = currentPasswordInput.closest('form') as HTMLFormElement;

    setInputValue(currentPasswordInput, STRONG_PASSWORD_73_BYTES);
    acknowledgement.checked = true;
    acknowledgement.dispatchEvent(new Event('change', { bubbles: true }));
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

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
