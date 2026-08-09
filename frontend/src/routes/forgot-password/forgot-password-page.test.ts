import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount } from '$lib/test/svelte-client';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/config', () => ({ API_BASE_URL: 'http://localhost:3000/api/v1' }));
vi.mock('$lib/stores/auth.svelte', () => ({
  authStore: {
    isInitializing: false,
    isLoggedIn: false
  }
}));
vi.mock('$lib/stores/toast.svelte', () => ({
  toastStore: { success: vi.fn() }
}));

import ForgotPasswordPage from './+page.svelte';

let mounted: ReturnType<typeof mount> | null = null;

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('/forgot-password top page navigation', () => {
  it('共通認証パネル内にトップページへ戻るブランドロゴリンクを表示する', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(ForgotPasswordPage, { target });

    const layout = target.querySelector<HTMLElement>('[data-auth-layout]');
    const panel = target.querySelector<HTMLElement>('[data-auth-panel]');

    expect(layout?.classList.contains('items-center')).toBe(true);
    expect(layout?.classList.contains('justify-center')).toBe(true);
    expect(panel?.classList.contains('border-border-panel')).toBe(true);
    expect(panel?.classList.contains('rounded')).toBe(true);
    expect(
      panel?.querySelector('a[href="/"][aria-label="Gensokoトップページへ戻る"]')
    ).not.toBeNull();
  });
});
