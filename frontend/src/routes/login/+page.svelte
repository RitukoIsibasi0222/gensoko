<script lang="ts">
  import { authStore, parseAuthSuccessResponse } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { goto } from '$app/navigation';
  import { ApiError, parseErrorBody } from '$lib/api/errors';
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
   * @param normalizedPassword - trim 済みパスワード（先頭/末尾スペースを除去した値）
   * @returns エラーメッセージ（エラーがない場合は null）
   */
  function validate(normalizedEmail: string, normalizedPassword: string): string | null {
    if (!normalizedEmail) {
      return 'メールアドレスを入力してください';
    }
    if (!normalizedPassword) {
      return 'パスワードを入力してください';
    }
    // パスワードは登録時にスペース禁止のため、trim 後に残る内部スペースを含む入力は必ず失敗する。
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
    const normalizedPassword = password.trim(); // バックエンドと同じく先頭/末尾スペースを除去する（内部スペースは validate で弾く）

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
        const errorBody = await parseErrorBody(response);
        // details[0].message を優先（400 バリデーションエラー時の具体的なメッセージを使用）
        const message = toJpMessage(
          response.status,
          errorBody?.details?.[0]?.message ?? errorBody?.error ?? ''
        );
        throw new ApiError(response.status, message, errorBody);
      }

      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        throw new ApiError(502, '認証応答を確認できません。しばらく経ってから再試行してください');
      }
      const data = parseAuthSuccessResponse(responseBody);
      if (data === null) {
        throw new ApiError(502, '認証応答を確認できません。しばらく経ってから再試行してください');
      }

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
  <h1 class="text-text text-2xl font-bold">ログイン</h1>

  <!-- novalidate でネイティブバリデーションを無効化し、カスタムバリデーションの日本語メッセージを優先する -->
  <form class="mt-6 space-y-4" novalidate onsubmit={handleSubmit}>
    <!-- エラーメッセージ表示 -->
    {#if errorMessage}
      <div
        id="login-error"
        role="alert"
        class="border-danger-border bg-danger-surface text-danger-text rounded-md border px-4 py-3 text-sm"
      >
        {errorMessage}
      </div>
    {/if}

    <!-- メールアドレス入力 -->
    <div>
      <label for="email" class="text-text block text-sm font-medium"> メールアドレス </label>
      <input
        id="email"
        type="email"
        bind:value={email}
        autocomplete="email"
        required
        aria-describedby={errorMessage ? 'login-error' : undefined}
        class="border-border focus:border-focus focus:ring-focus mt-1 w-full rounded-md border px-3 py-2 focus:ring-1 focus:outline-none"
      />
    </div>

    <!-- パスワード入力 -->
    <div>
      <label for="password" class="text-text block text-sm font-medium"> パスワード </label>
      <input
        id="password"
        type="password"
        bind:value={password}
        autocomplete="current-password"
        required
        aria-describedby={errorMessage ? 'login-error' : undefined}
        class="border-border focus:border-focus focus:ring-focus mt-1 w-full rounded-md border px-3 py-2 focus:ring-1 focus:outline-none"
      />
    </div>

    <!-- ログインボタン -->
    <button
      type="submit"
      disabled={isSubmitting}
      class="bg-action text-text-inverse hover:bg-action-hover focus:ring-focus w-full rounded-md px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isSubmitting ? 'ログイン中...' : 'ログイン'}
    </button>
  </form>

  <!-- パスワードリセットリンク -->
  <div class="mt-4 text-center text-sm">
    <a href="/forgot-password" class="text-action hover:underline">
      パスワードを忘れた方はこちら
    </a>
  </div>
</div>
