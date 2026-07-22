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
const REFRESHED_ACCESS_TOKEN = 'refreshed-access-token';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
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

    // refresh開始時点でstale tokenを即時に利用不能化する
    expect(sessionStorage.getItem('auth_token')).toBeNull();
    expect(sessionStorage.getItem('auth_user')).toBeNull();
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

describe('authStore production refresh coordination', () => {
  it('full reloadはrefresh responseのuserから認証状態を再構築する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        accessToken: REFRESHED_ACCESS_TOKEN,
        user: TEST_USER
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadAuthStore();

    await store.initialize();

    expect(store.isLoggedIn).toBe(true);
    expect(store.user).toEqual(TEST_USER);
    expect(store.accessToken).toBe(REFRESHED_ACCESS_TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('API先行rollout中は検証済み既存userと旧refresh responseを互換利用する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ accessToken: REFRESHED_ACCESS_TOKEN }))
    );
    const store = await loadAuthStore();
    store.login(TEST_USER, TEST_ACCESS_TOKEN);

    await expect(store.refresh()).resolves.toBe(true);

    expect(store.user).toEqual(TEST_USER);
    expect(store.accessToken).toBe(REFRESHED_ACCESS_TOKEN);
  });

  it('同一tabの同時refreshはsingle-flightで1 requestだけ送る', async () => {
    const gate = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(gate.promise);
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadAuthStore();
    store.login(TEST_USER, TEST_ACCESS_TOKEN);

    const first = store.refresh();
    const second = store.refresh();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.accessToken).toBeNull();
    gate.resolve(jsonResponse({ accessToken: REFRESHED_ACCESS_TOKEN, user: TEST_USER }));
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])('%sはstorageをclearしてanonymousにする', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: '拒否' }, status)));
    const store = await loadAuthStore();
    store.login(TEST_USER, TEST_ACCESS_TOKEN);

    await expect(store.refresh()).resolves.toBe(false);

    expect(store.state.status).toBe('anonymous');
    expect(store.user).toBeNull();
    expect(store.accessToken).toBeNull();
    expect(sessionStorage.getItem('auth_token')).toBeNull();
    expect(sessionStorage.getItem('auth_user')).toBeNull();
  });

  it.each([409, 500, 503, 502, 504])(
    '%sはstale tokenを利用不能にしてunavailableにする',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('gateway failure', { status }))
      );
      const store = await loadAuthStore();
      store.login(TEST_USER, TEST_ACCESS_TOKEN);

      await expect(store.refresh()).resolves.toBe(false);

      expect(store.state.status).toBe('unavailable');
      expect(store.accessToken).toBeNull();
      expect(sessionStorage.getItem('auth_token')).toBeNull();
    }
  );

  it('network errorはanonymousと混同せずunavailableにする', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')));
    const store = await loadAuthStore();
    store.login(TEST_USER, TEST_ACCESS_TOKEN);

    await expect(store.refresh()).resolves.toBe(false);

    expect(store.state.status).toBe('unavailable');
    expect(store.accessToken).toBeNull();
  });

  it('200でも非JSONまたは不正userならfail-closedでanonymousにする', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html>', { status: 200 }))
      .mockResolvedValueOnce(
        jsonResponse({ accessToken: REFRESHED_ACCESS_TOKEN, user: { id: 'user-1' } })
      );
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadAuthStore();
    store.login(TEST_USER, TEST_ACCESS_TOKEN);

    await expect(store.refresh()).resolves.toBe(false);
    expect(store.state.status).toBe('anonymous');
    store.login(TEST_USER, TEST_ACCESS_TOKEN);
    await expect(store.refresh()).resolves.toBe(false);
    expect(store.state.status).toBe('anonymous');
  });

  it('401後はrefresh 1回と最新tokenで元request 1回だけretryする', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ accessToken: REFRESHED_ACCESS_TOKEN, user: TEST_USER }))
    );
    const store = await loadAuthStore();
    store.login(TEST_USER, TEST_ACCESS_TOKEN);
    const request = vi
      .fn<(accessToken: string) => Promise<string>>()
      .mockRejectedValueOnce(new (await import('$lib/api/errors')).ApiError(401, '認証が必要です'))
      .mockResolvedValueOnce('ok');

    await expect(store.requestWithReauthentication(request)).resolves.toBe('ok');

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toBe(TEST_ACCESS_TOKEN);
    expect(request.mock.calls[1]?.[0]).toBe(REFRESHED_ACCESS_TOKEN);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retry後も401ならrefreshも元requestも追加実行しない', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ accessToken: REFRESHED_ACCESS_TOKEN, user: TEST_USER }))
    );
    const store = await loadAuthStore();
    const { ApiError } = await import('$lib/api/errors');
    store.login(TEST_USER, TEST_ACCESS_TOKEN);
    const request = vi
      .fn<(accessToken: string) => Promise<string>>()
      .mockRejectedValue(new ApiError(401, '認証が必要です'));

    await expect(store.requestWithReauthentication(request)).rejects.toMatchObject({ status: 401 });

    expect(request).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.state.status).toBe('anonymous');
  });

  it('403はrefreshせず認可errorをそのまま返す', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const store = await loadAuthStore();
    const { ApiError } = await import('$lib/api/errors');
    store.login(TEST_USER, TEST_ACCESS_TOKEN);
    const request = vi
      .fn<(accessToken: string) => Promise<string>>()
      .mockRejectedValue(new ApiError(403, '管理者権限が必要です'));

    await expect(store.requestWithReauthentication(request)).rejects.toMatchObject({ status: 403 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.isLoggedIn).toBe(true);
  });

  it('logoutのserver revoke失敗をfalseで検知しつつlocal stateはclearする', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: '失敗' }, 500)));
    const store = await loadAuthStore();
    store.login(TEST_USER, TEST_ACCESS_TOKEN);

    await expect(store.logout()).resolves.toBe(false);

    expect(store.state.status).toBe('anonymous');
    expect(store.user).toBeNull();
    expect(store.accessToken).toBeNull();
    expect(sessionStorage.getItem('auth_token')).toBeNull();
    expect(sessionStorage.getItem('auth_user')).toBeNull();
  });
});
