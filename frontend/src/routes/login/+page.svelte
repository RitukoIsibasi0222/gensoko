<script lang="ts">
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { goto } from '$app/navigation';
  import { ApiError } from '$lib/api/errors';

  // API ベース URL（authStore パターンに倣う）
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

  // 開発時のみ VITE_API_BASE_URL 未設定を早期検知する
  if (import.meta.env.DEV && !import.meta.env.VITE_API_BASE_URL) {
    console.warn(
      '[LoginPage] VITE_API_BASE_URL が設定されていません。' +
        'API リクエストが失敗する可能性があります。' +
        '.env ファイルに VITE_API_BASE_URL を設定してください。'
    );
  }

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
   * @returns エラーメッセージ（エラーがない場合は null）
   */
  function validate(): string | null {
    if (!email.trim()) {
      return 'メールアドレスを入力してください';
    }
    if (!password) {
      return 'パスワードを入力してください';
    }
    // 簡易的なメール形式チェック（@と.があるか）
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
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

    // クライアント側バリデーション
    const validationError = validate();
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
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password }),
        credentials: 'include' // HttpOnly Cookie 用
      });

      // authStore パターンに倣い、response.ok チェックを先に行う
      // （JSON パース前に HTTP ステータスを確認し、非 JSON レスポンス時のエラーを防ぐ）
      if (!response.ok) {
        // エラーレスポンスの場合は JSON パースを試みる
        let errorBody: { error?: string } = {};
        try {
          errorBody = await response.json();
        } catch {
          // JSON パース失敗時（502/504 等で HTML が返る場合）は空オブジェクトのまま
        }
        const message = toJpMessage(response.status, errorBody.error || '');
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
