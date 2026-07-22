import { browser } from '$app/environment';
import { API_BASE_URL } from '$lib/api/config';
import { ApiError } from '$lib/api/errors';

/**
 * ログイン中のユーザー情報。
 * POST /auth/login のレスポンス内 user オブジェクトの形に合わせている。
 *
 * id       → Prisma の cuid（例: "clx1abc..."）
 * username → 表示名（ヘッダーに出す）
 * role     → "USER" か "ADMIN"（管理者メニューの表示切り替えに使う）
 */
export type AuthUser = {
  id: string;
  username: string;
  role: 'USER' | 'ADMIN';
};

/**
 * Auth Store の初期化・認証状態を表すステータス。
 *
 * initializing → アプリ起動直後（sessionStorage 読込＋refresh 検証中）
 * authenticated → ログイン済み（refresh 成功 or login() 呼び出し後）
 * anonymous     → 未ログイン（refresh 失敗 or logout 後）
 *
 * UI は initializing 中は認証エリアを非表示にしてフリッカーを防ぐ。
 */
export type AuthStatus = 'initializing' | 'authenticated' | 'anonymous' | 'unavailable';
export type AuthenticatedRequest<T> = (latestAccessToken: string) => Promise<T>;

/**
 * Auth Store が持つ状態全体の形。
 *
 * user        → ログイン中: AuthUser オブジェクト / 未ログイン: null
 * accessToken → ログイン中: "eyJhb..." という文字列 / 未ログイン: null
 * status      → 初期化中 / 認証済み / 未ログインを区別する
 *
 * どちらも null のときが「未ログイン状態」。
 */
export type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  status: AuthStatus;
};

const STORAGE_KEY_TOKEN = 'auth_token';
const STORAGE_KEY_USER = 'auth_user';
const ACCOUNT_DELETION_CHANNEL_NAME = 'gensoko-auth';
const ACCOUNT_DELETION_EVENT_TYPE = 'account-deleted';

type AccountDeletionEvent = Readonly<{
  type: typeof ACCOUNT_DELETION_EVENT_TYPE;
}>;

const ACCOUNT_DELETION_EVENT: AccountDeletionEvent = Object.freeze({
  type: ACCOUNT_DELETION_EVENT_TYPE
});

function isAccountDeletionEvent(value: unknown): value is AccountDeletionEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && record.type === ACCOUNT_DELETION_EVENT_TYPE;
}

/**
 * 値が AuthUser の形を満たすかチェックする型ガード。
 * sessionStorage からの復元時など、型が不明な値の検証に使う。
 * フィールドを追加・変更する際はここだけ修正すれば済む。
 */
export function isAuthUser(value: unknown): value is AuthUser {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    typeof (value as Record<string, unknown>).id === 'string' &&
    'username' in value &&
    typeof (value as Record<string, unknown>).username === 'string' &&
    'role' in value &&
    ((value as Record<string, unknown>).role === 'USER' ||
      (value as Record<string, unknown>).role === 'ADMIN')
  );
}

type AuthSuccessResponse = Readonly<{
  accessToken: string;
  user: AuthUser;
}>;

export function parseAuthSuccessResponse(value: unknown): AuthSuccessResponse | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.accessToken !== 'string' ||
    record.accessToken.length === 0 ||
    !isAuthUser(record.user)
  ) {
    return null;
  }

  return { accessToken: record.accessToken, user: record.user };
}

class AuthStore {
  state = $state<AuthState>({
    user: null,
    accessToken: null,
    // 初期値を 'initializing' にすることで、SSR 時の出力（認証エリア非表示）と
    // hydration 初期状態を一致させ、hydration mismatch / ちらつきを防ぐ。
    // browser 環境では initialize() が同期的に status を上書きするため影響なし。
    status: 'initializing'
  });

  get user() {
    return this.state.user;
  }

  get accessToken() {
    return this.state.accessToken;
  }

  /** refresh 検証完了後にのみ true になる。sessionStorage 読込直後はまだ false。 */
  get isLoggedIn() {
    return this.state.status === 'authenticated';
  }

  /** アプリ起動時の初期化中（sessionStorage 読込＋refresh 検証中）は true。 */
  get isInitializing() {
    return this.state.status === 'initializing';
  }

  get isUnavailable() {
    return this.state.status === 'unavailable';
  }

  /**
   * 実行中の refresh() を追跡する AbortController。
   * login() / logout() / completeAccountDeletion() が呼ばれたとき、
   * または新しい refresh() が始まるときにキャンセルし、
   * 遅延完了した古い refresh() が最新の認証状態を上書きするレースコンディションを防ぐ。
   */
  #refreshAbortController: AbortController | null = null;
  #refreshPromise: Promise<boolean> | null = null;
  #authGeneration = 0;

  /**
   * 退会完了をPIIなしで他タブへ通知するchannel。
   * SSR・未対応browser・生成失敗時はnullのままcurrent tabだけをclearする。
   */
  #accountDeletionChannel: BroadcastChannel | null = null;

  constructor() {
    if (!browser || typeof BroadcastChannel === 'undefined') {
      return;
    }

    try {
      const channel = new BroadcastChannel(ACCOUNT_DELETION_CHANNEL_NAME);
      channel.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (isAccountDeletionEvent(event.data)) {
          this.#clearAfterAccountDeletion();
        }
      });
      this.#accountDeletionChannel = channel;
    } catch {
      // channelを利用できなくてもserver側token削除とcurrent tab clearを維持する
    }
  }

  /**
   * 現在の state を sessionStorage に保存する。
   * タブを閉じると自動で消えるため、localStorage より安全。
   */
  #saveToStorage() {
    try {
      sessionStorage.setItem(STORAGE_KEY_TOKEN, this.state.accessToken ?? '');
      sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(this.state.user));
    } catch {
      // プライベートブラウズ等で sessionStorage が使えない場合は無視する
    }
  }

  /**
   * additive rollout中の旧refresh response互換用に、検証済みuserだけを読み込む。
   * access tokenは期限・失効を確認できないため復元せず、refresh完了まで利用不能にする。
   */
  #loadUserFromStorage() {
    try {
      const userRaw = sessionStorage.getItem(STORAGE_KEY_USER);
      if (userRaw) {
        const parsed: unknown = JSON.parse(userRaw);
        if (isAuthUser(parsed)) {
          this.state.user = parsed;
        } else {
          this.#clearStorage();
        }
      }
    } catch {
      this.#clearStorage();
    }
  }

  /**
   * sessionStorage の認証情報をすべて削除する。
   */
  #clearStorage() {
    try {
      sessionStorage.removeItem(STORAGE_KEY_TOKEN);
      sessionStorage.removeItem(STORAGE_KEY_USER);
    } catch {
      // 削除に失敗しても処理を続ける
    }
  }

  /**
   * state を未ログイン状態にリセットし、sessionStorage もクリアする。
   * logout / refresh失敗 / account deletion時の共通処理。
   */
  #clearAuthState() {
    this.state.user = null;
    this.state.accessToken = null;
    this.state.status = 'anonymous';
    this.#clearStorage();
  }

  #enterUnavailableState() {
    this.state.accessToken = null;
    this.state.status = 'unavailable';
    this.#clearStorage();
  }

  #cancelRefresh() {
    this.#authGeneration += 1;
    this.#refreshAbortController?.abort();
    this.#refreshAbortController = null;
    this.#refreshPromise = null;
  }

  /**
   * 退会完了後の共通local clear。
   * 受信tabからも使い、eventの再送を起こさない。
   */
  #clearAfterAccountDeletion() {
    this.#cancelRefresh();
    this.#clearAuthState();
  }

  /**
   * 本人退会APIの成功後に呼ぶ。
   * server上のUser/tokenは既に削除済みなのでlogout APIは呼ばず、
   * current tabを同期clearしてからPIIなしeventだけを他タブへ送る。
   */
  completeAccountDeletion() {
    this.#clearAfterAccountDeletion();

    try {
      this.#accountDeletionChannel?.postMessage(ACCOUNT_DELETION_EVENT);
    } catch {
      // 通知失敗時もcurrent tabのclearは完了済みなので処理を継続する
    }
  }

  /**
   * ログイン成功時に呼ぶ。
   * state を更新し、sessionStorage にも保存する。
   */
  login(user: AuthUser, accessToken: string) {
    this.#cancelRefresh();
    this.state.user = user;
    this.state.accessToken = accessToken;
    this.state.status = 'authenticated';
    this.#saveToStorage();
  }

  /**
   * ログイン状態を維持したまま user 情報のみ更新する。
   * status が authenticated のときだけ反映し、accessToken/status は変更しない。
   */
  updateUser(user: AuthUser) {
    if (this.state.status !== 'authenticated') {
      return;
    }
    this.state.user = user;
    this.#saveToStorage();
  }

  /**
   * ログアウトする。
   * state と sessionStorage を先にクリアしてから POST /auth/logout を送信する。
   * fetch がネットワークハング等で完了しなくても、クリアは確実に実行される。
   *
   * 【前提】credentials: 'include' で HttpOnly Cookie（refreshToken）を送信する。
   * このコールが成功するには、バックエンド側の Cookie が
   * SameSite=None; Secure またはフロントと同一 site 内の構成である必要がある。
   * クロスサイト（eTLD+1 が異なる）構成では Cookie は送信されず logout API は失敗する
   * が、クライアント側のクリアは先に行うため認証状態は必ず消える。
   */
  async logout(): Promise<boolean> {
    this.#cancelRefresh();
    // fetch より先にクリアする。ネットワークがハングしても state/sessionStorage が
    // 残り続けるリスクをなくす（API 失敗・タイムアウトでもクライアント側は必ずログアウト）。
    this.#clearAuthState();
    try {
      const response = await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async #performRefresh(generation: number, controller: AbortController): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal
      });

      if (controller.signal.aborted || generation !== this.#authGeneration) {
        return false;
      }

      if (res.status === 401 || res.status === 403) {
        this.#clearAuthState();
        return false;
      }

      if (!res.ok) {
        this.#enterUnavailableState();
        return false;
      }

      let value: unknown;
      try {
        value = await res.json();
      } catch {
        this.#clearAuthState();
        return false;
      }

      if (controller.signal.aborted || generation !== this.#authGeneration) {
        return false;
      }

      let response = parseAuthSuccessResponse(value);
      if (
        response === null &&
        this.state.user !== null &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !('user' in value) &&
        'accessToken' in value &&
        typeof value.accessToken === 'string' &&
        value.accessToken.length > 0
      ) {
        // API先行rollout中の旧response互換。user fieldが存在する不正responseはfallbackしない。
        response = { accessToken: value.accessToken, user: this.state.user };
      }

      if (response === null) {
        this.#clearAuthState();
        return false;
      }

      this.state.accessToken = response.accessToken;
      this.state.user = response.user;
      this.state.status = 'authenticated';
      this.#saveToStorage();
      return true;
    } catch (err) {
      // AbortError はキャンセルによる中断なので state をクリアしない
      if (err instanceof DOMException && err.name === 'AbortError') {
        return false;
      }
      if (generation === this.#authGeneration) {
        this.#enterUnavailableState();
      }
      return false;
    }
  }

  async #performRefreshWithBrowserLock(
    generation: number,
    controller: AbortController
  ): Promise<boolean> {
    if (!browser || navigator.locks === undefined) {
      return this.#performRefresh(generation, controller);
    }

    return navigator.locks.request('gensoko-auth-refresh', () =>
      this.#performRefresh(generation, controller)
    );
  }

  /**
   * HttpOnly refresh Cookieから認証状態を再構築する。同一tab内は必ずsingle-flightにし、
   * Web Locks対応browserでは同一originのtab間も直列化する。
   */
  refresh(): Promise<boolean> {
    if (this.#refreshPromise !== null) {
      return this.#refreshPromise;
    }

    this.state.accessToken = null;
    this.state.status = 'initializing';
    this.#clearStorage();

    const generation = this.#authGeneration;
    const controller = new AbortController();
    this.#refreshAbortController = controller;
    const operation = this.#performRefreshWithBrowserLock(generation, controller);
    const tracked = operation.finally(() => {
      if (this.#refreshPromise === tracked) {
        this.#refreshPromise = null;
        this.#refreshAbortController = null;
      }
    });
    this.#refreshPromise = tracked;
    return tracked;
  }

  async requestWithReauthentication<T>(request: AuthenticatedRequest<T>): Promise<T> {
    const currentAccessToken = this.state.accessToken;
    if (this.state.status !== 'authenticated' || currentAccessToken === null) {
      throw new ApiError(401, '認証が必要です');
    }

    try {
      return await request(currentAccessToken);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        throw error;
      }
    }

    const refreshed = await this.refresh();
    const refreshedAccessToken = this.state.accessToken;
    if (!refreshed || refreshedAccessToken === null) {
      if (this.isUnavailable) {
        throw new ApiError(503, '認証サーバーに接続できません。再試行してください');
      }
      throw new ApiError(401, '認証が必要です');
    }

    try {
      return await request(refreshedAccessToken);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.#clearAuthState();
      }
      throw error;
    }
  }

  async initialize(): Promise<void> {
    this.state.status = 'initializing';
    this.state.accessToken = null;
    this.#loadUserFromStorage();
    await this.refresh();
  }

  async retryInitialize(): Promise<void> {
    await this.initialize();
  }
}

export const authStore = new AuthStore();
