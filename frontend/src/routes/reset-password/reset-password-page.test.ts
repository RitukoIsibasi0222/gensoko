import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from '$lib/test/svelte-client';
import { STRONG_PASSWORD_73_BYTES } from '$lib/test/password-byte-boundary-fixtures';
import { PASSWORD_TOO_LONG_MESSAGE } from '$lib/validation/password';

const VALID_TOKEN = 'a'.repeat(64);
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  goto: vi.fn(),
  replaceState: vi.fn(),
  toastSuccess: vi.fn(),
  page: {
    url: new URL(`http://localhost/reset-password?token=${'a'.repeat(64)}`),
    state: {} as Record<string, unknown>
  }
}));

vi.mock('$app/navigation', () => ({
  goto: mocks.goto,
  replaceState: mocks.replaceState
}));
vi.mock('svelte', async () => await import('$lib/test/svelte-client'));
vi.mock('$app/state', () => ({
  page: mocks.page
}));
vi.mock('$lib/api/config', () => ({ API_BASE_URL: 'http://localhost:3000/api/v1' }));
vi.mock('$lib/stores/auth.svelte', () => ({
  authStore: {
    isInitializing: false,
    isLoggedIn: false
  }
}));
vi.mock('$lib/stores/toast.svelte', () => ({
  toastStore: { success: mocks.toastSuccess }
}));

import ResetPasswordPage from './+page.svelte';

const PASSWORD_HINT = 'UTF-8で72バイト以内（日本語や絵文字は1文字で複数バイトになります）';

let mounted: ReturnType<typeof mount> | null = null;

async function renderPage(): Promise<HTMLElement> {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(ResetPasswordPage, { target });
  await tick();
  await tick();
  return target;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submitPassword(target: HTMLElement, value: string): Promise<HTMLInputElement> {
  const passwordInput = target.querySelector('#password') as HTMLInputElement;
  const confirmPasswordInput = target.querySelector('#confirm-password') as HTMLInputElement;
  const form = target.querySelector('form') as HTMLFormElement;

  setInputValue(passwordInput, value);
  setInputValue(confirmPasswordInput, value);
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await tick();
  await tick();

  return passwordInput;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.page.url = new URL(`http://localhost/reset-password?token=${VALID_TOKEN}`);
  mocks.page.state = {};
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('/reset-password password byte limit UI/A11Y', () => {
  it('上限hintを常時関連付け、文字数maxlengthは設定しない', async () => {
    const target = await renderPage();
    const passwordInput = target.querySelector('#password') as HTMLInputElement;
    const hint = target.querySelector('#password-hint');

    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain(PASSWORD_HINT);
    expect(passwordInput.getAttribute('aria-describedby')).toBe('password-hint');
    expect(passwordInput.hasAttribute('maxlength')).toBe(false);
  });

  it('73バイトではfetchせずhint・errorをpasswordへ関連付ける', async () => {
    const target = await renderPage();
    const passwordInput = await submitPassword(target, STRONG_PASSWORD_73_BYTES);

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(target.querySelector('#password-error')?.textContent).toContain(
      PASSWORD_TOO_LONG_MESSAGE
    );
    expect(passwordInput.getAttribute('aria-invalid')).toBe('true');
    expect(passwordInput.getAttribute('aria-describedby')).toBe('password-hint password-error');
  });

  it('73バイトのvalidation error後はpasswordへfocusする', async () => {
    const target = await renderPage();
    const passwordInput = await submitPassword(target, STRONG_PASSWORD_73_BYTES);

    expect(document.activeElement).toBe(passwordInput);
  });

  it('validation error後に修正して再送信しても元のtokenを使用する', async () => {
    const target = await renderPage();
    await submitPassword(target, STRONG_PASSWORD_73_BYTES);
    mocks.fetch.mockResolvedValue({ ok: true });

    await submitPassword(target, 'Passw0r!');

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [, request] = mocks.fetch.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(request.body)).toEqual({
      token: VALID_TOKEN,
      password: 'Passw0r!'
    });
  });
});
