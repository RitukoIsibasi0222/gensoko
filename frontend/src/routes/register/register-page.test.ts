import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from '$lib/test/svelte-client';
import { PASSWORD_BYTE_LIMIT_HINT, PASSWORD_TOO_LONG_MESSAGE } from '$lib/validation/password';
import { STRONG_PASSWORD_73_BYTES } from '$lib/test/password-byte-boundary-fixtures';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  goto: vi.fn(),
  toastSuccess: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
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

import RegisterPage from './+page.svelte';

let mounted: ReturnType<typeof mount> | null = null;

function renderPage(): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(RegisterPage, { target });
  return target;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submitOverlongPassword(target: HTMLElement): Promise<HTMLInputElement> {
  const usernameInput = target.querySelector('#username') as HTMLInputElement;
  const emailInput = target.querySelector('#email') as HTMLInputElement;
  const passwordInput = target.querySelector('#password') as HTMLInputElement;
  const form = target.querySelector('form') as HTMLFormElement;

  setInputValue(usernameInput, 'taro123');
  setInputValue(emailInput, 'taro@example.com');
  setInputValue(passwordInput, STRONG_PASSWORD_73_BYTES);
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await tick();
  await tick();

  return passwordInput;
}

beforeEach(() => {
  vi.clearAllMocks();
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

describe('/register password byte limit UI/A11Y', () => {
  it('上限hintを常時関連付け、文字数maxlengthは設定しない', () => {
    const target = renderPage();
    const passwordInput = target.querySelector('#password') as HTMLInputElement;
    const hint = target.querySelector('#password-hint');

    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain(PASSWORD_BYTE_LIMIT_HINT);
    expect(passwordInput.getAttribute('aria-describedby')).toBe('password-hint');
    expect(passwordInput.hasAttribute('maxlength')).toBe(false);
  });

  it('73バイトではfetchせずhint・errorをpasswordへ関連付ける', async () => {
    const target = renderPage();
    const passwordInput = await submitOverlongPassword(target);

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(target.querySelector('#password-error')?.textContent).toContain(
      PASSWORD_TOO_LONG_MESSAGE
    );
    expect(passwordInput.getAttribute('aria-invalid')).toBe('true');
    expect(passwordInput.getAttribute('aria-describedby')).toBe('password-hint password-error');
  });

  it('73バイトのvalidation error後はpasswordへfocusする', async () => {
    const target = renderPage();
    const passwordInput = await submitOverlongPassword(target);

    expect(document.activeElement).toBe(passwordInput);
  });
});

describe('/register privacy navigation contract', () => {
  it('登録前に識別できる/privacy導線をform内へ表示する', () => {
    const target = renderPage();
    const form = target.querySelector<HTMLFormElement>('form');

    expect(form).not.toBeNull();
    if (!form) {
      throw new Error('登録フォームが見つかりません');
    }

    const link = form.querySelector<HTMLAnchorElement>('a[href="/privacy"]');
    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(link).not.toBeNull();
    expect(submitButton).not.toBeNull();
    if (!link || !submitButton) {
      throw new Error('登録フォーム内のprivacy導線または送信ボタンが見つかりません');
    }

    expect(link.textContent).toContain('プライバシーポリシー');
    expect(link.classList.contains('text-action-text')).toBe(true);
    expect(
      Boolean(link.compareDocumentPosition(submitButton) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);

    link.focus();
    expect(document.activeElement).toBe(link);
  });
});
