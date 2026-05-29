import { API_BASE_URL } from '$lib/api/config';

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
export type AuthStatus = 'initializing' | 'authenticated' | 'anonymous';

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

/**
 * 値が AuthUser の形を満たすかチェックする型ガード。
 * sessionStorage からの復元時など、型が不明な値の検証に使う。
 * フィールドを追加・変更する際はここだけ修正すれば済む。
 */
function isAuthUser(value: unknown): value is AuthUser {
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

  /**
   * 実行中の refresh() を追跡する AbortController。
   * login() / logout() が呼ばれたとき、または新しい refresh() が始まるときにキャンセルし、
   * 遅延完了した古い refresh() が最新の認証状態を上書きするレースコンディションを防ぐ。
   */
  #refreshAbortController: AbortController | null = null;

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
   * sessionStorage から状態を読み込んで state に反映する。
   * トークンまたはユーザー情報が存在しない・不正な場合は何もしない。
   */
  #loadFromStorage() {
    try {
      const token = sessionStorage.getItem(STORAGE_KEY_TOKEN);
      const userRaw = sessionStorage.getItem(STORAGE_KEY_USER);
      if (token && userRaw) {
        const parsed: unknown = JSON.parse(userRaw);
        // isAuthUser 型ガードで検証してから state に反映する（フィールド検証は1箇所に集約）
        if (isAuthUser(parsed)) {
          this.state.accessToken = token;
          this.state.user = parsed;
        } else {
          // 形が不正なデータが残り続けると次回起動でも失敗を繰り返すため、即座にクリアする
          this.#clearStorage();
        }
      } else if (token || userRaw) {
        // 片方だけ残っている場合（古い実装の残骸・手動削除・書き込み途中等）は
        // XSS リスク軽減のため両方クリアして整合性を保つ
        this.#clearStorage();
      }
    } catch {
      // JSON.parse に失敗した場合も壊れたデータが残るのを防ぐためクリアする
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
   * logout / refresh 失敗時の共通処理。
   */
  #clearAuthState() {
    this.state.user = null;
    this.state.accessToken = null;
    this.state.status = 'anonymous';
    this.#clearStorage();
  }

  /**
   * ログイン成功時に呼ぶ。
   * state を更新し、sessionStorage にも保存する。
   */
  login(user: AuthUser, accessToken: string) {
    // 実行中の refresh があればキャンセルして最新のログイン状態が上書きされるのを防ぐ
    this.#refreshAbortController?.abort();
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
  async logout() {
    // 実行中の refresh があればキャンセルして logout 後に状態が復元されるのを防ぐ
    this.#refreshAbortController?.abort();
    // fetch より先にクリアする。ネットワークがハングしても state/sessionStorage が
    // 残り続けるリスクをなくす（API 失敗・タイムアウトでもクライアント側は必ずログアウト）。
    this.#clearAuthState();
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch {
      // ネットワークエラー等は無視する（既にクリア済み）
    }
  }

  /**
   * リフレッシュトークン（HttpOnly Cookie）を使って accessToken を更新する。
   * 成功: 新しい accessToken を state と sessionStorage に保存する。
   * 失敗: 期限切れ・不正トークンとみなし、state と sessionStorage をクリアする。
   * 戻り値: 更新に成功したか否かの boolean。
   */
  async refresh(): Promise<boolean> {
    // 前の refresh があればキャンセルし、最新の呼び出しだけが state を更新できるようにする
    this.#refreshAbortController?.abort();
    const controller = new AbortController();
    this.#refreshAbortController = controller;

    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        // HttpOnly Cookie（refreshToken）を自動送信する。
        // 【前提】バックエンド Cookie が SameSite=None; Secure または
        // フロントと同一 site（同一 eTLD+1）構成でなければ Cookie は送信されず常に失敗する。
        // クロスサイト（eTLD+1 が異なる）構成では SameSite=Strict/Lax の Cookie は送信されない。
        credentials: 'include',
        signal: controller.signal
      });
      // fetch 完了後にキャンセルされていたら state を変更しない
      if (controller.signal.aborted) return false;
      if (!res.ok) {
        this.#clearAuthState();
        return false;
      }
      const data = (await res.json()) as { accessToken?: unknown };
      // JSON パース後にもキャンセルを確認する
      if (controller.signal.aborted) return false;
      // バックエンドが 200 を返しつつ accessToken が欠損・非文字列の場合を弾く。
      // 型キャストだけでは実行時に undefined が混入するため、ランタイム検証を行う。
      if (typeof data.accessToken !== 'string' || data.accessToken.length === 0) {
        this.#clearAuthState();
        return false;
      }
      this.state.accessToken = data.accessToken;
      // user が null のまま authenticated にすると isLoggedIn が true なのに
      // ユーザー名が表示できない等の状態不整合が起きるため、user がない場合はクリアする。
      // （refresh() は initialize() 以外から単独で呼ばれる可能性もあるため）
      if (this.state.user === null) {
        this.#clearAuthState();
        return false;
      }
      this.state.status = 'authenticated';
      this.#saveToStorage();
      return true;
    } catch (err) {
      // AbortError はキャンセルによる中断なので state をクリアしない
      if (err instanceof DOMException && err.name === 'AbortError') {
        return false;
      }
      this.#clearAuthState();
      return false;
    }
  }

  /**
   * アプリ起動時に呼ぶ。
   * 1. status を 'initializing' にして初期化中であることを示す（フリッカー防止）
   * 2. sessionStorage から状態を読み込む
   * 3. sessionStorage にユーザー情報があればリフレッシュトークンで有効性を確認する
   * 4. sessionStorage に情報がなければ 'anonymous' にして終了する
   */
  async initialize() {
    this.state.status = 'initializing';
    this.#loadFromStorage();
    if (this.state.user !== null) {
      await this.refresh(); // 成功→status='authenticated'、失敗→status='anonymous'
    } else {
      this.state.status = 'anonymous';
    }
  }
}

export const authStore = new AuthStore();
