import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount } from '$lib/test/svelte-client';

import Footer from './Footer.svelte';

let mounted: ReturnType<typeof mount> | null = null;

function renderFooter(): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(Footer, { target });
  return target;
}

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('Footer privacy navigation contract', () => {
  it('識別できる名前を持つ/privacy導線を表示する', () => {
    const target = renderFooter();
    const footer = target.querySelector('footer');
    const link = target.querySelector<HTMLAnchorElement>('a[href="/privacy"]');

    expect(footer?.classList.contains('bg-action')).toBe(true);
    expect(footer?.classList.contains('border-t')).toBe(false);
    expect(footer?.classList.contains('border-border-muted')).toBe(false);
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('プライバシーポリシー');
    expect(link?.classList.contains('text-text-inverse')).toBe(true);

    link?.focus();
    expect(document.activeElement).toBe(link);
  });
});
