import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from '$lib/test/svelte-client';

const mocks = vi.hoisted(() => ({
  auth: {
    status: 'authenticated' as 'initializing' | 'authenticated' | 'anonymous',
    user: {
      id: 'admin-1',
      username: 'admin',
      role: 'ADMIN' as 'USER' | 'ADMIN'
    } as { id: string; username: string; role: 'USER' | 'ADMIN' } | null
  },
  logout: vi.fn()
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
    logout: mocks.logout
  }
}));

import Header from './Header.svelte';

let mounted: ReturnType<typeof mount> | null = null;

function renderHeader(): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(Header, { target });
  return target;
}

async function renderFor(
  status: 'initializing' | 'authenticated' | 'anonymous',
  role: 'USER' | 'ADMIN' | null
): Promise<HTMLElement> {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
  mocks.auth.status = status;
  mocks.auth.user =
    role === null ? null : { id: role === 'ADMIN' ? 'admin-1' : 'user-1', username: 'user', role };
  const target = renderHeader();
  await tick();
  return target;
}

beforeEach(() => {
  mocks.auth.status = 'authenticated';
  mocks.auth.user = { id: 'admin-1', username: 'admin', role: 'ADMIN' };
  mocks.logout.mockReset();
});

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('Header admin navigation', () => {
  it('ログイン済みの挨拶をdesktopとmobileの両方で句読点なしの2段表示にする', async () => {
    const target = await renderFor('authenticated', 'USER');
    const greetings = target.querySelectorAll<HTMLElement>('[data-user-greeting]');

    expect(greetings).toHaveLength(2);
    for (const greeting of greetings) {
      expect(greeting.children).toHaveLength(2);
      expect(greeting.children[0]?.textContent).toBe('こんにちは');
      expect(greeting.children[1]?.textContent).toBe('userさん');
      expect(greeting.children[0]?.classList.contains('block')).toBe(true);
      expect(greeting.children[1]?.classList.contains('block')).toBe(true);
      expect(greeting.textContent).not.toContain('、');
      expect(greeting.textContent).not.toContain(' さん');
    }
  });

  it('theme toggleをdesktopとmobile menuの両方から操作可能にする', async () => {
    const target = renderHeader();
    await tick();

    const themeToggles = target.querySelectorAll<HTMLButtonElement>(
      'button[aria-label$="モードに切り替える"]'
    );
    const mobileNavigation = target.querySelector('#mobile-navigation');

    expect(themeToggles).toHaveLength(2);
    expect(mobileNavigation?.contains(themeToggles[1])).toBe(true);
    expect((mobileNavigation as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect(mobileNavigation?.getAttribute('aria-hidden')).toBe('true');
  });

  it('ADMINにはdesktopとmobileの両方で管理者導線を表示する', async () => {
    const target = renderHeader();
    await tick();

    const adminLinks = target.querySelectorAll<HTMLAnchorElement>('a[href="/admin"]');
    expect(adminLinks).toHaveLength(2);
    expect(target.querySelector('nav > div > ul a[href="/admin"]')?.textContent).toContain(
      '管理者'
    );
    expect(target.querySelector('#mobile-navigation a[href="/admin"]')?.textContent).toContain(
      '管理者'
    );
  });

  it('initializing・anonymous・USERでは隠し、authenticated ADMINだけに表示する', async () => {
    let target = await renderFor('initializing', 'ADMIN');
    expect(target.querySelector('a[href="/admin"]')).toBeNull();

    target = await renderFor('anonymous', null);
    expect(target.querySelector('a[href="/admin"]')).toBeNull();

    target = await renderFor('authenticated', 'USER');
    expect(target.querySelector('a[href="/admin"]')).toBeNull();

    target = await renderFor('authenticated', 'ADMIN');
    expect(target.querySelectorAll('a[href="/admin"]')).toHaveLength(2);
  });

  it('mobileの管理者導線を選択した後にmenuを閉じる', async () => {
    const target = renderHeader();
    const toggleButton = target.querySelector<HTMLButtonElement>(
      'button[aria-controls="mobile-navigation"]'
    );
    toggleButton?.click();
    await tick();

    expect(toggleButton?.getAttribute('aria-expanded')).toBe('true');
    const mobileAdminLink = target.querySelector<HTMLAnchorElement>(
      '#mobile-navigation a[href="/admin"]'
    );
    expect(mobileAdminLink).not.toBeNull();

    mobileAdminLink?.addEventListener('click', (event) => event.preventDefault());
    mobileAdminLink?.click();
    await tick();
    expect(toggleButton?.getAttribute('aria-expanded')).toBe('false');
    expect(target.querySelector('#mobile-navigation')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('既存のprimary・authenticated導線を維持して管理者導線を追加する', async () => {
    const target = renderHeader();
    await tick();

    for (const href of ['/elements', '/game', '/ranking', '/weak', '/mypage', '/admin']) {
      expect(target.querySelectorAll(`a[href="${href}"]`), href).toHaveLength(2);
    }
  });
});
