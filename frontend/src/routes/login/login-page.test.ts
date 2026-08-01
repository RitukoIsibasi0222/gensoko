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
  parseAuthSuccessResponse: (value: unknown) => {
    if (value === null || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const user = record.user as Record<string, unknown> | undefined;
    if (
      typeof record.accessToken !== 'string' ||
      record.accessToken.length === 0 ||
      user === undefined ||
      typeof user.id !== 'string' ||
      typeof user.username !== 'string' ||
      (user.role !== 'USER' && user.role !== 'ADMIN')
    ) {
      return null;
    }
    return { accessToken: record.accessToken, user };
  },
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

function mountAndSubmitLogin(): HTMLDivElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(LoginPage, { target });

  setInputValue(target.querySelector('#email') as HTMLInputElement, 'taro@example.com');
  setInputValue(target.querySelector('#password') as HTMLInputElement, 'StrongPass1!');
  (target.querySelector('form') as HTMLFormElement).dispatchEvent(
    new SubmitEvent('submit', { bubbles: true, cancelable: true })
  );

  return target;
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

describe('/login rate-limit error handling', () => {
  it('429 JSONの日本語messageをrole=alertへ表示する', async () => {
    const message = 'リクエストが多すぎます。しばらく待ってから再試行してください';
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({ error: message })
    });

    const target = mountAndSubmitLogin();

    await vi.waitFor(() => {
      expect(target.querySelector('[role="alert"]')?.textContent).toContain(message);
    });
    const alert = target.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(alert);
    expect((target.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('503 JSONの日本語messageをrole=alertへ表示する', async () => {
    const message = '一時的に利用できません。しばらく待ってから再試行してください';
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({ error: message })
    });

    const target = mountAndSubmitLogin();

    await vi.waitFor(() => {
      expect(target.querySelector('[role="alert"]')?.textContent).toContain(message);
    });
    expect((target.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('非JSONの429はログイン用fallbackをrole=alertへ表示する', async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token'))
    });

    const target = mountAndSubmitLogin();

    await vi.waitFor(() => {
      expect(target.querySelector('[role="alert"]')?.textContent).toContain(
        'リクエストが多すぎます。しばらく経ってから再試行してください'
      );
    });
  });

  it('ネットワークエラーは接続確認messageをrole=alertへ表示する', async () => {
    mocks.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const target = mountAndSubmitLogin();

    await vi.waitFor(() => {
      expect(target.querySelector('[role="alert"]')?.textContent).toContain(
        'ネットワークエラーが発生しました。接続を確認してください'
      );
    });
  });
});

describe('/login accessibility', () => {
  it('空のemailはAPIを呼ばずemail inputをinvalidとしてfocusする', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(LoginPage, { target });

    (target.querySelector('form') as HTMLFormElement).dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true })
    );

    const emailInput = target.querySelector('#email') as HTMLInputElement;
    const passwordInput = target.querySelector('#password') as HTMLInputElement;
    await vi.waitFor(() => expect(document.activeElement).toBe(emailInput));
    expect(emailInput.getAttribute('aria-invalid')).toBe('true');
    expect(emailInput.getAttribute('aria-describedby')).toBe('login-error');
    expect(passwordInput.hasAttribute('aria-invalid')).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('email入力済みでpasswordが空ならpassword inputをinvalidとしてfocusする', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(LoginPage, { target });
    const emailInput = target.querySelector('#email') as HTMLInputElement;
    setInputValue(emailInput, 'taro@example.com');

    (target.querySelector('form') as HTMLFormElement).dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true })
    );

    const passwordInput = target.querySelector('#password') as HTMLInputElement;
    await vi.waitFor(() => expect(document.activeElement).toBe(passwordInput));
    expect(passwordInput.getAttribute('aria-invalid')).toBe('true');
    expect(passwordInput.getAttribute('aria-describedby')).toBe('login-error');
    expect(emailInput.hasAttribute('aria-invalid')).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('/login success response validation', () => {
  it('200でもuserが不正ならloginせず安全なrole=alertを表示する', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        user: { id: 'user-1' },
        accessToken: 'new-access-token'
      })
    });

    const target = mountAndSubmitLogin();

    await vi.waitFor(() => {
      expect(target.querySelector('[role="alert"]')?.textContent).toContain(
        '認証応答を確認できません'
      );
    });
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('200でも非JSONならnetwork errorと混同せず安全なrole=alertを表示する', async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token'))
    });

    const target = mountAndSubmitLogin();

    await vi.waitFor(() => {
      expect(target.querySelector('[role="alert"]')?.textContent).toContain(
        '認証応答を確認できません'
      );
    });
    expect(mocks.login).not.toHaveBeenCalled();
  });
});
