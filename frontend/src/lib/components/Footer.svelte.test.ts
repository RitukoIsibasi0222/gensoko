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
    const link = target.querySelector<HTMLAnchorElement>('a[href="/privacy"]');

    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('プライバシーポリシー');
  });
});
