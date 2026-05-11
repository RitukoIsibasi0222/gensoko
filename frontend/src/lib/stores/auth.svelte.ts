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
 * Auth Store が持つ状態全体の形。
 *
 * user        → ログイン中: AuthUser オブジェクト / 未ログイン: null
 * accessToken → ログイン中: "eyJhb..." という文字列 / 未ログイン: null
 *
 * どちらも null のときが「未ログイン状態」。
 */
export type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
};

const STORAGE_KEY_TOKEN = 'auth_token';
const STORAGE_KEY_USER = 'auth_user';

class AuthStore {
  state = $state<AuthState>({
    user: null,
    accessToken: null
  });

  get user() {
    return this.state.user;
  }

  get accessToken() {
    return this.state.accessToken;
  }

  get isLoggedIn() {
    return this.state.user !== null;
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
   * トークンまたはユーザー情報が存在しない場合は何もしない。
   */
  #loadFromStorage() {
    try {
      const token = sessionStorage.getItem(STORAGE_KEY_TOKEN);
      const userRaw = sessionStorage.getItem(STORAGE_KEY_USER);
      if (token && userRaw) {
        this.state.accessToken = token;
        this.state.user = JSON.parse(userRaw) as AuthUser;
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
   * ログイン成功時に呼ぶ。
   * state を更新し、sessionStorage にも保存する。
   */
  login(user: AuthUser, accessToken: string) {
    this.state.user = user;
    this.state.accessToken = accessToken;
    this.#saveToStorage();
  }

  /**
   * ログアウトする。
   * POST /auth/logout で DB のリフレッシュトークンを削除した後、
   * API の成否にかかわらず state と sessionStorage を必ずクリアする。
   */
  async logout() {
    const baseUrl = import.meta.env.VITE_API_BASE_URL as string;
    try {
      await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch {
      // ネットワークエラー等は無視してクリアへ進む
    } finally {
      this.state.user = null;
      this.state.accessToken = null;
      this.#clearStorage();
    }
  }

  /**
   * リフレッシュトークン（HttpOnly Cookie）を使って accessToken を更新する。
   * 成功: 新しい accessToken を state と sessionStorage に保存する。
   * 失敗: 期限切れ・不正トークンとみなし、state と sessionStorage をクリアする。
   * 戻り値: 更新に成功したか否かの boolean。
   */
  async refresh(): Promise<boolean> {
    const baseUrl = import.meta.env.VITE_API_BASE_URL as string;
    try {
      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include' // HttpOnly Cookie を自動送信
      });
      if (!res.ok) {
        this.state.user = null;
        this.state.accessToken = null;
        this.#clearStorage();
        return false;
      }
      const data = (await res.json()) as { accessToken: string };
      this.state.accessToken = data.accessToken;
      this.#saveToStorage();
      return true;
    } catch {
      this.state.user = null;
      this.state.accessToken = null;
      this.#clearStorage();
      return false;
    }
  }

  /**
   * アプリ起動時に呼ぶ。
   * sessionStorage から状態を読み込み、リフレッシュトークンでセッションの有効性を確認する。
   * sessionStorage に情報がなければ未ログイン状態のまま何もしない。
   */
  async initialize() {
    this.#loadFromStorage();
    if (this.state.user !== null) {
      await this.refresh();
    }
  }
}

export const authStore = new AuthStore();
