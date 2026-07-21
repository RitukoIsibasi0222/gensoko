import { browser } from '$app/environment';

export type ThemePreference = 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export type ThemeStorageChange = Readonly<{
  key: string | null;
  newValue: string | null;
}>;

export type ThemeRuntime = Readonly<{
  root: {
    dataset: Record<string, string | undefined>;
    style: { colorScheme: string };
  };
  storageKey: string;
  getSystemTheme(): ResolvedTheme;
  readPreference(): string | null;
  writePreference(preference: ThemePreference): void;
  removePreference(): void;
  subscribeToSystemTheme(listener: (matchesDark: boolean) => void): () => void;
  subscribeToStorage(listener: (change: ThemeStorageChange) => void): () => void;
}>;

type ThemeState = {
  preference: ThemePreference | null;
  resolvedTheme: ResolvedTheme;
};

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark';
}

function createBrowserRuntime(): ThemeRuntime | null {
  if (!browser || typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  const root = document.documentElement;
  const storageKey = root.dataset.themeStorageKey?.trim();
  const mediaQueryValue = root.dataset.themeMediaQuery?.trim();
  if (!storageKey || !mediaQueryValue) {
    return null;
  }

  const mediaQuery =
    typeof window.matchMedia === 'function' ? window.matchMedia(mediaQueryValue) : null;

  return {
    root,
    storageKey,
    getSystemTheme: () => (mediaQuery?.matches ? 'dark' : 'light'),
    readPreference: () => window.localStorage.getItem(storageKey),
    writePreference: (preference) => window.localStorage.setItem(storageKey, preference),
    removePreference: () => window.localStorage.removeItem(storageKey),
    subscribeToSystemTheme(listener) {
      if (!mediaQuery) return () => undefined;

      const handleChange = (event: MediaQueryListEvent) => listener(event.matches);
      const legacyMediaQuery = mediaQuery as LegacyMediaQueryList;
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
      }

      legacyMediaQuery.addListener?.(handleChange);
      return () => legacyMediaQuery.removeListener?.(handleChange);
    },
    subscribeToStorage(listener) {
      const handleStorage = (event: StorageEvent) => {
        listener({ key: event.key, newValue: event.newValue });
      };
      window.addEventListener('storage', handleStorage);
      return () => window.removeEventListener('storage', handleStorage);
    }
  };
}

class ThemeStore {
  #runtime: ThemeRuntime | null | undefined;
  #initialized = false;
  #unsubscribeSystemTheme: (() => void) | null = null;
  #unsubscribeStorage: (() => void) | null = null;

  state = $state<ThemeState>({
    preference: null,
    resolvedTheme: 'light'
  });

  constructor(runtime: ThemeRuntime | null | undefined) {
    this.#runtime = runtime;
  }

  get preference(): ThemePreference | null {
    return this.state.preference;
  }

  get resolvedTheme(): ResolvedTheme {
    return this.state.resolvedTheme;
  }

  get isDark(): boolean {
    return this.state.resolvedTheme === 'dark';
  }

  initialize(): void {
    if (this.#initialized) return;

    const runtime = this.#runtime === undefined ? createBrowserRuntime() : this.#runtime;
    if (!runtime) return;

    this.#runtime = runtime;
    this.#initialized = true;

    const storedPreference = this.#readPreference(runtime);
    if (isThemePreference(storedPreference)) {
      this.state.preference = storedPreference;
    } else {
      this.state.preference = null;
      if (storedPreference !== null) {
        this.#removePreference(runtime);
      }
    }

    this.#resolveAndApply(runtime);
    this.#unsubscribeSystemTheme = runtime.subscribeToSystemTheme((matchesDark) => {
      if (this.state.preference !== null) return;
      this.state.resolvedTheme = matchesDark ? 'dark' : 'light';
      this.#applyTheme(runtime);
    });
    this.#unsubscribeStorage = runtime.subscribeToStorage((change) => {
      this.#handleStorageChange(runtime, change);
    });
  }

  toggle(): void {
    if (!this.#initialized) this.initialize();

    const nextPreference: ThemePreference = this.isDark ? 'light' : 'dark';
    this.state.preference = nextPreference;
    this.state.resolvedTheme = nextPreference;

    const runtime = this.#runtime;
    if (!runtime) return;

    try {
      runtime.writePreference(nextPreference);
    } catch {
      // 保存できないbrowserでも現在のtabでは切替を継続する
    }
    this.#applyTheme(runtime);
  }

  destroy(): void {
    this.#unsubscribeSystemTheme?.();
    this.#unsubscribeStorage?.();
    this.#unsubscribeSystemTheme = null;
    this.#unsubscribeStorage = null;
    this.#initialized = false;
  }

  #readPreference(runtime: ThemeRuntime): string | null {
    try {
      return runtime.readPreference();
    } catch {
      return null;
    }
  }

  #removePreference(runtime: ThemeRuntime): void {
    try {
      runtime.removePreference();
    } catch {
      // 削除不能でも不正値はstateへ採用しない
    }
  }

  #getSystemTheme(runtime: ThemeRuntime): ResolvedTheme {
    try {
      return runtime.getSystemTheme();
    } catch {
      return 'light';
    }
  }

  #resolveAndApply(runtime: ThemeRuntime): void {
    this.state.resolvedTheme = this.state.preference ?? this.#getSystemTheme(runtime);
    this.#applyTheme(runtime);
  }

  #applyTheme(runtime: ThemeRuntime): void {
    runtime.root.dataset.theme = this.state.resolvedTheme;
    runtime.root.style.colorScheme = this.state.resolvedTheme;
  }

  #handleStorageChange(runtime: ThemeRuntime, change: ThemeStorageChange): void {
    if (change.key !== null && change.key !== runtime.storageKey) return;

    if (isThemePreference(change.newValue)) {
      this.state.preference = change.newValue;
    } else {
      this.state.preference = null;
      if (change.newValue !== null) {
        this.#removePreference(runtime);
      }
    }
    this.#resolveAndApply(runtime);
  }
}

/** @internal テストでは明示runtimeを渡し、productionではbrowser adapterを遅延生成する。 */
export function createThemeStore(runtime?: ThemeRuntime | null): ThemeStore {
  return new ThemeStore(runtime);
}

export const themeStore = createThemeStore();
