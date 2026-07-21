import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, tick, unmount } from '$lib/test/svelte-client';

const mocks = vi.hoisted(() => ({
  isDark: false,
  toggle: vi.fn()
}));

vi.mock('$lib/stores/theme.svelte', () => ({
  themeStore: {
    get isDark() {
      return mocks.isDark;
    },
    toggle: mocks.toggle
  }
}));

import ThemeToggle from './ThemeToggle.svelte';

let mounted: ReturnType<typeof mount> | null = null;

function renderToggle(): HTMLButtonElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(ThemeToggle, { target });
  const button = target.querySelector<HTMLButtonElement>('button');
  if (!button) throw new Error('theme toggle buttonが見つかりません');
  return button;
}

beforeEach(() => {
  mocks.isDark = false;
  mocks.toggle.mockReset();
});

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('ThemeToggle', () => {
  it('light時はdarkへ切り替える名前と未選択状態を伝える', async () => {
    const button = renderToggle();
    await tick();

    expect(button.getAttribute('aria-label')).toBe('ダークモードに切り替える');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.textContent).toContain('ダーク');
  });

  it('dark時はlightへ切り替える名前と選択状態を伝える', async () => {
    mocks.isDark = true;
    const button = renderToggle();
    await tick();

    expect(button.getAttribute('aria-label')).toBe('ライトモードに切り替える');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('ライト');
  });

  it('clickでtheme storeを1回toggleする', () => {
    const button = renderToggle();

    button.click();

    expect(mocks.toggle).toHaveBeenCalledTimes(1);
  });

  it('native buttonとしてkeyboard focusを受け取る', () => {
    const button = renderToggle();

    button.focus();

    expect(button.type).toBe('button');
    expect(document.activeElement).toBe(button);
  });
});
