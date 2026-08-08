import { afterEach, describe, expect, it } from 'vitest';
import { mount, unmount } from '$lib/test/svelte-client';
import HeroSection from './HeroSection.svelte';

const primaryCta = {
  href: '/game',
  label: 'ゲームを始める',
  description: '今日の学習をすぐに始めます。',
  disabled: false
};
const secondaryCta = {
  href: '/elements',
  label: '元素一覧を見る',
  description: 'ゲーム前の復習として、元素一覧を確認できます。',
  disabled: false
};

let mounted: ReturnType<typeof mount> | null = null;

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('HeroSection', () => {
  it('説明文を親要素の幅いっぱいに表示する', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    mounted = mount(HeroSection, {
      target,
      props: {
        title: '元素を、遊んで覚える。',
        description: '説明文',
        primaryCta,
        secondaryCta
      }
    });

    const description = [...target.querySelectorAll('p')].find(
      (paragraph) => paragraph.textContent === '説明文'
    );

    expect(description?.classList.contains('w-full')).toBe(true);
    expect(description?.className).not.toContain('max-w-');
  });
});
