import { afterEach, describe, expect, it, vi } from 'vitest';

import { createThemeStore, type ThemeRuntime, type ThemeStorageChange } from './theme.svelte';

type RuntimeHarness = {
  runtime: ThemeRuntime;
  root: ThemeRuntime['root'];
  storage: Map<string, string>;
  emitMediaChange(matches: boolean): void;
  emitStorageChange(change: ThemeStorageChange): void;
  mediaSubscribe: ReturnType<typeof vi.fn>;
  storageSubscribe: ReturnType<typeof vi.fn>;
};

const STORAGE_KEY = 'test-theme-key';

function createRuntimeHarness(
  options: {
    storedTheme?: string | null;
    osDark?: boolean;
    storageError?: boolean;
  } = {}
): RuntimeHarness {
  const storage = new Map<string, string>();
  if (options.storedTheme !== undefined && options.storedTheme !== null) {
    storage.set(STORAGE_KEY, options.storedTheme);
  }

  let osDark = options.osDark ?? false;
  const mediaListeners = new Set<(matches: boolean) => void>();
  const storageListeners = new Set<(change: ThemeStorageChange) => void>();
  const root: ThemeRuntime['root'] = {
    dataset: {},
    style: { colorScheme: '' }
  };

  const mediaSubscribe = vi.fn((listener: (matches: boolean) => void) => {
    mediaListeners.add(listener);
    return () => mediaListeners.delete(listener);
  });
  const storageSubscribe = vi.fn((listener: (change: ThemeStorageChange) => void) => {
    storageListeners.add(listener);
    return () => storageListeners.delete(listener);
  });

  const runtime: ThemeRuntime = {
    root,
    storageKey: STORAGE_KEY,
    getSystemTheme: () => (osDark ? 'dark' : 'light'),
    readPreference: () => {
      if (options.storageError) throw new Error('storage unavailable');
      return storage.get(STORAGE_KEY) ?? null;
    },
    writePreference: (preference) => {
      if (options.storageError) throw new Error('storage unavailable');
      storage.set(STORAGE_KEY, preference);
    },
    removePreference: () => {
      if (options.storageError) throw new Error('storage unavailable');
      storage.delete(STORAGE_KEY);
    },
    subscribeToSystemTheme: mediaSubscribe,
    subscribeToStorage: storageSubscribe
  };

  return {
    runtime,
    root,
    storage,
    mediaSubscribe,
    storageSubscribe,
    emitMediaChange(matches: boolean) {
      osDark = matches;
      for (const listener of mediaListeners) listener(matches);
    },
    emitStorageChange(change: ThemeStorageChange) {
      for (const listener of storageListeners) listener(change);
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ThemeStore', () => {
  it('SSR runtimeではbrowser APIへ触れずlightの安全な初期値を維持する', () => {
    const store = createThemeStore(null);

    expect(() => store.initialize()).not.toThrow();
    expect(store.preference).toBeNull();
    expect(store.resolvedTheme).toBe('light');
    expect(store.isDark).toBe(false);
  });

  it('保存値がなくOSがdarkならdarkを適用する', () => {
    const harness = createRuntimeHarness({ osDark: true });
    const store = createThemeStore(harness.runtime);

    store.initialize();

    expect(store.preference).toBeNull();
    expect(store.resolvedTheme).toBe('dark');
    expect(harness.root.dataset.theme).toBe('dark');
    expect(harness.root.style.colorScheme).toBe('dark');
  });

  it('保存値がなくOSがlightならlightを適用する', () => {
    const harness = createRuntimeHarness({ osDark: false });
    const store = createThemeStore(harness.runtime);

    store.initialize();

    expect(store.preference).toBeNull();
    expect(store.resolvedTheme).toBe('light');
    expect(harness.root.dataset.theme).toBe('light');
  });

  it('保存済みdarkをOS lightより優先する', () => {
    const harness = createRuntimeHarness({ storedTheme: 'dark', osDark: false });
    const store = createThemeStore(harness.runtime);

    store.initialize();

    expect(store.preference).toBe('dark');
    expect(store.resolvedTheme).toBe('dark');
  });

  it('不正な保存値を削除してOS設定へfallbackする', () => {
    const harness = createRuntimeHarness({ storedTheme: 'sepia', osDark: true });
    const store = createThemeStore(harness.runtime);

    store.initialize();

    expect(store.preference).toBeNull();
    expect(store.resolvedTheme).toBe('dark');
    expect(harness.storage.has(STORAGE_KEY)).toBe(false);
  });

  it('toggleでeffective themeを反転し明示値として保存する', () => {
    const harness = createRuntimeHarness({ osDark: true });
    const store = createThemeStore(harness.runtime);
    store.initialize();

    store.toggle();

    expect(store.preference).toBe('light');
    expect(store.resolvedTheme).toBe('light');
    expect(harness.storage.get(STORAGE_KEY)).toBe('light');
    expect(harness.root.dataset.theme).toBe('light');
  });

  it('明示値がない間だけOS設定変更へ追従する', () => {
    const harness = createRuntimeHarness({ osDark: false });
    const store = createThemeStore(harness.runtime);
    store.initialize();

    harness.emitMediaChange(true);
    expect(store.resolvedTheme).toBe('dark');

    store.toggle();
    harness.emitMediaChange(true);
    expect(store.preference).toBe('light');
    expect(store.resolvedTheme).toBe('light');
  });

  it('別tabの有効な保存値と削除を同期する', () => {
    const harness = createRuntimeHarness({ osDark: true });
    const store = createThemeStore(harness.runtime);
    store.initialize();

    harness.emitStorageChange({ key: STORAGE_KEY, newValue: 'light' });
    expect(store.preference).toBe('light');
    expect(store.resolvedTheme).toBe('light');

    harness.emitStorageChange({ key: STORAGE_KEY, newValue: null });
    expect(store.preference).toBeNull();
    expect(store.resolvedTheme).toBe('dark');
  });

  it('別tabの不正値を採用せずOS設定へfallbackする', () => {
    const harness = createRuntimeHarness({ storedTheme: 'light', osDark: true });
    const store = createThemeStore(harness.runtime);
    store.initialize();

    harness.emitStorageChange({ key: STORAGE_KEY, newValue: 'contrast' });

    expect(store.preference).toBeNull();
    expect(store.resolvedTheme).toBe('dark');
  });

  it('無関係なstorage eventを無視する', () => {
    const harness = createRuntimeHarness({ storedTheme: 'dark', osDark: false });
    const store = createThemeStore(harness.runtime);
    store.initialize();

    harness.emitStorageChange({ key: 'other-key', newValue: 'light' });

    expect(store.preference).toBe('dark');
    expect(store.resolvedTheme).toBe('dark');
  });

  it('storageが利用不能でもOS反映とtoggleを継続する', () => {
    const harness = createRuntimeHarness({ osDark: true, storageError: true });
    const store = createThemeStore(harness.runtime);

    expect(() => store.initialize()).not.toThrow();
    expect(store.resolvedTheme).toBe('dark');
    expect(() => store.toggle()).not.toThrow();
    expect(store.resolvedTheme).toBe('light');
    expect(harness.root.dataset.theme).toBe('light');
  });

  it('initializeを複数回呼んでもevent購読を重複させない', () => {
    const harness = createRuntimeHarness();
    const store = createThemeStore(harness.runtime);

    store.initialize();
    store.initialize();

    expect(harness.mediaSubscribe).toHaveBeenCalledTimes(1);
    expect(harness.storageSubscribe).toHaveBeenCalledTimes(1);
  });
});
