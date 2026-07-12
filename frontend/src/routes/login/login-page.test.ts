import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount } from '$lib/test/svelte-client';
import { STRONG_PASSWORD_73_BYTES } from '$lib/test/password-byte-boundary-fixtures';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  goto: vi.fn(),
  login: vi.fn(),
  toastSuccess: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/api/config', () => ({ API_BASE_URL: 'http://localhost:3000/api/v1' }));
vi.mock('$lib/stores/auth.svelte', () => ({
  authStore: {
    isInitializing: false,
    isLoggedIn: false,
    login: mocks.login
  }
}));
vi.mock('$lib/stores/toast.svelte', () => ({
  toastStore: { success: mocks.toastSuccess }
}));

import LoginPage from './+page.svelte';

let mounted: ReturnType<typeof mount> | null = null;

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({
      user: { id: 'user-1', username: 'taro', role: 'USER' },
      accessToken: 'new-access-token'
    })
  });
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

describe('/login existing-password compatibility', () => {
  it('sends the complete normalized 73-byte password without a client max limit', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(LoginPage, { target });

    const emailInput = target.querySelector('#email') as HTMLInputElement;
    const passwordInput = target.querySelector('#password') as HTMLInputElement;
    const form = target.querySelector('form') as HTMLFormElement;

    setInputValue(emailInput, '  taro@example.com  ');
    setInputValue(passwordInput, `  ${STRONG_PASSWORD_73_BYTES}  `);
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    });

    const [, request] = mocks.fetch.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(request.body)).toEqual({
      email: 'taro@example.com',
      password: STRONG_PASSWORD_73_BYTES
    });
    expect(passwordInput.hasAttribute('maxlength')).toBe(false);
  });
});
