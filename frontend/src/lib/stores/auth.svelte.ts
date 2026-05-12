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
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// 開発時のみ VITE_API_BASE_URL 未設定を早期検知する。
// 本番ビルドでコンソールに出続けないよう import.meta.env.DEV で限定する。
if (import.meta.env.DEV && !import.meta.env.VITE_API_BASE_URL) {
  console.warn(
    '[AuthStore] VITE_API_BASE_URL が設定されていません。' +
      'API リクエストが同一オリジンに飛んで 404 になる可能性があります。' +
      '.env ファイルに VITE_API_BASE_URL を設定してください。'
  );
}

class AuthStore {
  state = $state<AuthState>({
    user: null,
    accessToken: null,
    status: 'anonymous'
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
        const parsed = JSON.parse(userRaw) as unknown;
        // 不正なデータ（フィールド欠損・型違い）を読み込まないよう最低限検証する
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'id' in parsed &&
          typeof (parsed as Record<string, unknown>).id === 'string' &&
          'username' in parsed &&
          typeof (parsed as Record<string, unknown>).username === 'string' &&
          'role' in parsed &&
          ((parsed as Record<string, unknown>).role === 'USER' ||
            (parsed as Record<string, unknown>).role === 'ADMIN')
        ) {
          this.state.accessToken = token;
          this.state.user = parsed as AuthUser;
        }
      }
    } catch {
      // 読み込みに失敗した場合は未ログイン状態のまま
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
    this.state.user = user;
    this.state.accessToken = accessToken;
    this.state.status = 'authenticated';
    this.#saveToStorage();
  }

  /**
   * ログアウトする。
   * POST /auth/logout で DB のリフレッシュトークンを削除した後、
   * API の成否にかかわらず state と sessionStorage を必ずクリアする。
   */
  async logout() {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch {
      // ネットワークエラー等は無視してクリアへ進む
    } finally {
      this.#clearAuthState();
    }
  }

  /**
   * リフレッシュトークン（HttpOnly Cookie）を使って accessToken を更新する。
   * 成功: 新しい accessToken を state と sessionStorage に保存する。
   * 失敗: 期限切れ・不正トークンとみなし、state と sessionStorage をクリアする。
   * 戻り値: 更新に成功したか否かの boolean。
   */
  async refresh(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include' // HttpOnly Cookie を自動送信
      });
      if (!res.ok) {
        this.#clearAuthState();
        return false;
      }
      const data = (await res.json()) as { accessToken: string };
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
    } catch {
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
