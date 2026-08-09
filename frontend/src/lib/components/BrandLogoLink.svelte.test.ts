import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount } from '$lib/test/svelte-client';

import BrandLogoLink from './BrandLogoLink.svelte';

let mounted: ReturnType<typeof mount> | null = null;

function renderBrandLogoLink(accessibleLabel?: string): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(BrandLogoLink, {
    target,
    props: { accessibleLabel }
  });
  return target;
}

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('BrandLogoLink', () => {
  it('ロゴ画像とGensokoテキストをトップページへのリンクとして表示する', () => {
    const target = renderBrandLogoLink();
    const link = target.querySelector<HTMLAnchorElement>('a[href="/"]');
    const image = link?.querySelector<HTMLImageElement>('img');

    expect(link?.textContent?.trim()).toBe('Gensoko');
    expect(image?.getAttribute('src')).toBe('/logo.png');
    expect(image?.getAttribute('alt')).toBe('');
    expect(image?.classList.contains('w-[30px]')).toBe(true);
    expect(image?.classList.contains('h-auto')).toBe(true);
  });

  it('画面用途に応じた読み上げ名を設定できる', () => {
    const target = renderBrandLogoLink('Gensokoトップページへ戻る');

    expect(target.querySelector('a')?.getAttribute('aria-label')).toBe('Gensokoトップページへ戻る');
  });
});
