import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AuthStoreModule = typeof import('./auth.svelte');
type AccountDeletionAuthStore = AuthStoreModule['authStore'] & {
  completeAccountDeletion(): void;
};
type MessageListener = (event: MessageEvent<unknown>) => void;

const TEST_USER = {
  id: 'user-secret-id',
  username: 'secret-username',
  role: 'USER' as const
};
const TEST_ACCESS_TOKEN = 'secret-access-token';

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];

  readonly name: string;
  onmessage: MessageListener | null = null;
  readonly postMessage = vi.fn<(message: unknown) => void>();
  readonly close = vi.fn();
  readonly #messageListeners: MessageListener[] = [];

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  addEventListener(type: string, listener: MessageListener): void {
    if (type === 'message') {
      this.#messageListeners.push(listener);
    }
  }

  emit(data: unknown): void {
    const event = { data } as MessageEvent<unknown>;
    this.onmessage?.(event);
    for (const listener of this.#messageListeners) {
      listener(event);
    }
  }
}

async function loadAuthStore(options?: {
  browser?: boolean;
  channelSupported?: boolean;
}): Promise<AccountDeletionAuthStore> {
  const browser = options?.browser ?? true;
  const channelSupported = options?.channelSupported ?? true;

  vi.resetModules();
  vi.doMock('$app/environment', () => ({
    browser,
    building: false,
    dev: true,
    version: 'test'
  }));
  vi.stubGlobal('BroadcastChannel', channelSupported ? MockBroadcastChannel : undefined);

  const { authStore } = await import('./auth.svelte');
  return authStore as AccountDeletionAuthStore;
}

function stubPendingRefresh(): {
  fetchMock: ReturnType<typeof vi.fn>;
  getSignal: () => AbortSignal | undefined;
} {
  let capturedSignal: AbortSignal | undefined;
  const fetchMock = vi.fn(
    (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      capturedSignal = init?.signal ?? undefined;

      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true }
        );
      });
    }
  );
  vi.stubGlobal('fetch', fetchMock);

  return {
    fetchMock,
    getSignal: () => capturedSignal
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  MockBroadcastChannel.instances.length = 0;
  sessionStorage.clear();
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.doUnmock('$app/environment');
  vi.resetModules();
});

describe('authStore account deletion local/cross-tab clear', () => {
  it('現在tabのrefresh・state・storageを同期clearし、PIIなしeventだけを送る', async () => {
    const store = await loadAuthStore();
    const { fetchMock, getSignal } = stubPendingRefresh();
    store.login(TEST_USER, TEST_ACCESS_TOKEN);
    const refreshResult = store.refresh();

    expect(sessionStorage.getItem('auth_token')).toBe(TEST_ACCESS_TOKEN);
    expect(sessionStorage.getItem('auth_user')).toContain(TEST_USER.id);
    expect(getSignal()?.aborted).toBe(false);

    store.completeAccountDeletion();

    expect(store.user).toBeNull();
    expect(store.accessToken).toBeNull();
    expect(store.isLoggedIn).toBe(false);
    expect(sessionStorage.getItem('auth_token')).toBeNull();
    expect(sessionStorage.getItem('auth_user')).toBeNull();
    expect(getSignal()?.aborted).toBe(true);
    await expect(refreshResult).resolves.toBe(false);

    const channel = MockBroadcastChannel.instances[0];
    expect(channel?.postMessage).toHaveBeenCalledOnce();
    expect(channel?.postMessage).toHaveBeenCalledWith({ type: 'account-deleted' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/auth/refresh');
  });

  it('受信tabもrefresh・state・storageをclearし、eventを再送しない', async () => {
    const store = await loadAuthStore();
    const { fetchMock, getSignal } = stubPendingRefresh();
    store.login(TEST_USER, TEST_ACCESS_TOKEN);
    const refreshResult = store.refresh();
    const channel = MockBroadcastChannel.instances[0];

    expect(channel).toBeDefined();
    channel?.emit({ type: 'account-deleted' });

    expect(store.user).toBeNull();
    expect(store.accessToken).toBeNull();
    expect(store.isLoggedIn).toBe(false);
    expect(sessionStorage.getItem('auth_token')).toBeNull();
    expect(sessionStorage.getItem('auth_user')).toBeNull();
    expect(getSignal()?.aborted).toBe(true);
    await expect(refreshResult).resolves.toBe(false);
    expect(channel?.postMessage).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('別type・null・PIIを追加したeventは無視する', async () => {
    const store = await loadAuthStore();
    store.login(TEST_USER, TEST_ACCESS_TOKEN);
    const channel = MockBroadcastChannel.instances[0];

    expect(channel).toBeDefined();
    channel?.emit({ type: 'logout' });
    channel?.emit(null);
    channel?.emit({ type: 'account-deleted', userId: TEST_USER.id });

    expect(store.user).toEqual(TEST_USER);
    expect(store.accessToken).toBe(TEST_ACCESS_TOKEN);
    expect(store.isLoggedIn).toBe(true);
    expect(sessionStorage.getItem('auth_token')).toBe(TEST_ACCESS_TOKEN);
    expect(channel?.postMessage).not.toHaveBeenCalled();
  });

  it('BroadcastChannel未対応browserでもcurrent tabだけ安全にclearする', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadAuthStore({ channelSupported: false });
    store.login(TEST_USER, TEST_ACCESS_TOKEN);

    expect(() => store.completeAccountDeletion()).not.toThrow();
    expect(store.user).toBeNull();
    expect(store.accessToken).toBeNull();
    expect(store.isLoggedIn).toBe(false);
    expect(sessionStorage.getItem('auth_token')).toBeNull();
    expect(sessionStorage.getItem('auth_user')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(MockBroadcastChannel.instances).toHaveLength(0);
  });

  it('SSRではchannelを作らずcurrent stateを安全にclearする', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadAuthStore({ browser: false });
    store.login(TEST_USER, TEST_ACCESS_TOKEN);

    expect(MockBroadcastChannel.instances).toHaveLength(0);
    expect(() => store.completeAccountDeletion()).not.toThrow();
    expect(store.user).toBeNull();
    expect(store.accessToken).toBeNull();
    expect(store.isLoggedIn).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
