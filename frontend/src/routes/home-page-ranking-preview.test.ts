import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte', async () => await import('$lib/test/svelte-client'));
vi.mock('$lib/api/ranking', () => ({
  getRanking: vi.fn()
}));

import { mount, unmount } from '$lib/test/svelte-client';
import HomePage from './(app)/+page.svelte';
import { getRanking } from '$lib/api/ranking';

let mounted: ReturnType<typeof mount> | null = null;

function renderHomePage(): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(HomePage, { target });
  return target;
}

async function waitForMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('HomePage ranking preview', () => {
  it('error: 自動再リクエストせず error 表示を維持する', async () => {
    vi.mocked(getRanking).mockRejectedValue(new Error('network down'));

    const target = renderHomePage();
    await waitForMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitForMicrotasks();

    expect(getRanking).toHaveBeenCalledTimes(1);
    expect(target.textContent).toContain(
      'ネットワークエラーが発生しました。接続を確認してください。'
    );

    const retryButton = target.querySelector('button') as HTMLButtonElement;
    retryButton.click();
    await waitForMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getRanking).toHaveBeenCalledTimes(2);
  });
});
