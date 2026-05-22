<script lang="ts">
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { goto } from '$app/navigation';
  import { ApiError } from '$lib/api/errors';
  import { API_BASE_URL } from '$lib/api/config';
  import { isValidEmailFormat } from '$lib/validation/email';

  // フォーム入力値
  let email = $state('');
  let password = $state('');

  // フォーム送信中フラグ（送信中は true にしてボタンを無効化する）
  let isSubmitting = $state(false);

  // エラーメッセージ（エラーがない時は null）
  let errorMessage = $state<string | null>(null);

  // 既にログイン済みならトップページにリダイレクト
  // 初期化中（refresh トークン検証中）は判定しない
  $effect(() => {
    if (!authStore.isInitializing && authStore.isLoggedIn) {
      goto('/');
    }
  });

  /**
   * クライアント側バリデーション
   * @param normalizedEmail - trim 済みメールアドレス
   * @param normalizedPassword - パスワード（trim しない。スペースを含む入力はそのまま渡す）
   * @returns エラーメッセージ（エラーがない場合は null）
   */
  function validate(normalizedEmail: string, normalizedPassword: string): string | null {
    if (!normalizedEmail) {
      return 'メールアドレスを入力してください';
    }
    if (!normalizedPassword) {
      return 'パスワードを入力してください';
    }
    // スペースを含むパスワードは登録時に拒否されるため、ログインも必ず失敗する。
    // 送信前にクライアント側でバリデーションエラーとして弾き、不要な loginFailCount 増加を防ぐ。
    if (/ /.test(normalizedPassword)) {
      return 'パスワードにスペースは使用できません';
    }
    // 簡易的なメール形式チェック（@と.があるか）
    // trim 済みの値でチェックすることで、空白混入による形式不正を防ぐ
    if (!isValidEmailFormat(normalizedEmail)) {
      return 'メールアドレスの形式が正しくありません';
    }
    return null;
  }

  /**
   * HTTP ステータスコードを日本語エラーメッセージに変換
   * バックエンドからの具体的なエラーメッセージ（fallback）がある場合は優先する。
   * @param status - HTTP ステータスコード
   * @param fallback - API が返したエラーメッセージ（具体的な理由）
   * @returns 日本語エラーメッセージ
   */
  function toJpMessage(status: number, fallback: string): string {
    // バックエンドが具体的なメッセージを返している場合は優先する
    // （例: 「メールアドレスが確認されていません」「しばらく後に再試行してください」（ロック中））
    if (fallback) {
      return fallback;
    }

    // fallback がない場合のみ、ステータスコードに基づいたデフォルトメッセージを返す
    switch (status) {
      case 400:
        return '入力内容に誤りがあります';
      case 401:
        return 'メールアドレスまたはパスワードが正しくありません';
      case 403:
        return 'アカウントが停止されています。管理者にお問い合わせください';
      case 429:
        return 'リクエストが多すぎます。しばらく経ってから再試行してください';
      default:
        return 'ログインに失敗しました。しばらく経ってから再試行してください';
    }
  }

  /**
   * フォーム送信ハンドラー（ログイン処理）
   */
  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    // 多重送信防止: 送信中は早期リターン
    // （連打やEnterキー連続押下でログインAPIが複数回叩かれるのを防ぐ）
    if (isSubmitting) {
      return;
    }

    // 正規化値を一度だけ計算し、バリデーションと送信の両方で共用する
    const normalizedEmail = email.trim();
    const normalizedPassword = password; // パスワードは trim しない（スペースを含む入力をそのままバリデーション・送信する）

    // クライアント側バリデーション
    const validationError = validate(normalizedEmail, normalizedPassword);
    if (validationError) {
      errorMessage = validationError;
      return;
    }

    // エラーメッセージをクリア
    errorMessage = null;
    isSubmitting = true;

    try {
      // ログイン API 呼び出し（authStore パターンに倣う）
      // API_BASE_URL には既に /api/v1 が含まれているので、エンドポイントのパスだけを追加する
      // normalizedEmail/normalizedPassword は上で一度計算済みの値を利用する
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: normalizedEmail, password: normalizedPassword }),
        credentials: 'include' // HttpOnly Cookie 用
      });

      // authStore パターンに倣い、response.ok チェックを先に行う
      // （JSON パース前に HTTP ステータスを確認し、非 JSON レスポンス時のエラーを防ぐ）
      if (!response.ok) {
        // エラーレスポンスの場合は JSON パースを試みる
        let errorBody: { error?: string; details?: { message: string }[] } | null = null;
        try {
          errorBody = await response.json();
        } catch {
          // JSON パース失敗時（502/504 等の非 JSON レスポンス）は null のまま
        }
        // details[0].message を優先（400 バリデーションエラー時の具体的なメッセージを使用）
        const message = toJpMessage(
          response.status,
          errorBody?.details?.[0]?.message ?? errorBody?.error ?? ''
        );
        throw new ApiError(response.status, message, errorBody);
      }

      // 成功レスポンスの場合は JSON をパース
      const data = await response.json();

      // ログイン成功: authStore.login() を呼ぶと state が変化し、
      // $effect が自動的にリダイレクトするため、ここでは goto() を呼ばない
      authStore.login(data.user, data.accessToken);
      toastStore.success('ログインしました');
    } catch (error) {
      // ApiError の場合
      if (error instanceof ApiError) {
        errorMessage = error.message;
      } else {
        // ネットワークエラー等
        errorMessage = 'ネットワークエラーが発生しました。接続を確認してください';
      }
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="mx-auto max-w-md px-4 py-8">
  <h1 class="text-2xl font-bold text-gray-800">ログイン</h1>

  <!-- novalidate でネイティブバリデーションを無効化し、カスタムバリデーションの日本語メッセージを優先する -->
  <form class="mt-6 space-y-4" novalidate onsubmit={handleSubmit}>
    <!-- エラーメッセージ表示 -->
    {#if errorMessage}
      <div
        id="login-error"
        role="alert"
        class="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
      >
        {errorMessage}
      </div>
    {/if}

    <!-- メールアドレス入力 -->
    <div>
      <label for="email" class="block text-sm font-medium text-gray-700"> メールアドレス </label>
      <input
        id="email"
        type="email"
        bind:value={email}
        autocomplete="email"
        required
        aria-describedby={errorMessage ? 'login-error' : undefined}
        class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
      />
    </div>

    <!-- パスワード入力 -->
    <div>
      <label for="password" class="block text-sm font-medium text-gray-700"> パスワード </label>
      <input
        id="password"
        type="password"
        bind:value={password}
        autocomplete="current-password"
        required
        aria-describedby={errorMessage ? 'login-error' : undefined}
        class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
      />
    </div>

    <!-- ログインボタン -->
    <button
      type="submit"
      disabled={isSubmitting}
      class="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isSubmitting ? 'ログイン中...' : 'ログイン'}
    </button>
  </form>

  <!-- パスワードリセットリンク -->
  <div class="mt-4 text-center text-sm">
    <a href="/forgot-password" class="text-blue-600 hover:underline">
      パスワードを忘れた方はこちら
    </a>
  </div>
</div>
