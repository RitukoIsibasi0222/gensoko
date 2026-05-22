<script lang="ts">
  import { API_BASE_URL } from '$lib/api/config';
  import { ApiError } from '$lib/api/errors';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { validateUsername, validateEmail, validatePassword } from './validation';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.svelte';

  // フォーム入力値
  let username = $state('');
  let email = $state('');
  let password = $state('');

  // フォーム送信中フラグ（送信中は true にしてボタンを無効化する）
  let isSubmitting = $state(false);

  // 送信成功フラグ（true になったらフォームを隠して完了メッセージを表示）
  let isSuccess = $state(false);

  // フィールドごとのバリデーションエラー
  let usernameError = $state<string | null>(null);
  let emailError = $state<string | null>(null);
  let passwordError = $state<string | null>(null);

  // フォーム共通エラー（API エラー・ネットワークエラー用）
  let formError = $state<string | null>(null);

  // 既にログイン済みならトップページにリダイレクト
  // 初期化中（refresh トークン検証中）は判定しない
  $effect(() => {
    if (!authStore.isInitializing && authStore.isLoggedIn) {
      goto('/');
    }
  });

  /**
   * フォーム送信ハンドラー（ユーザー登録処理）
   */
  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    // 多重送信防止: 送信中は早期リターン
    if (isSubmitting) {
      return;
    }

    // 正規化値を一度だけ計算し、バリデーションと送信の両方で共用する
    const normalizedUsername = username.trim();
    const normalizedEmail = email.trim();
    const normalizedPassword = password.trim();

    // フィールドごとにバリデーションを実行し、エラーを state にセットする
    usernameError = validateUsername(normalizedUsername);
    emailError = validateEmail(normalizedEmail);
    passwordError = validatePassword(normalizedPassword);

    if (usernameError || emailError || passwordError) {
      return;
    }

    // フォーム共通エラーをクリアして送信開始
    formError = null;
    isSubmitting = true;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: normalizedUsername,
          email: normalizedEmail,
          password: normalizedPassword
        })
      });

      // response.ok チェックを先に行う（JSON パース前に HTTP ステータスを確認）
      if (!response.ok) {
        let errorBody: { error?: string } | null = null;
        try {
          errorBody = await response.json();
        } catch {
          // JSON パース失敗時（502/504 等の非 JSON レスポンス）は null のまま
        }
        throw new ApiError(response.status, errorBody?.error || 'エラーが発生しました', errorBody);
      }

      // 登録成功: 成功フラグを立てて完了トーストを表示
      isSuccess = true;
      toastStore.success('確認メールを送信しました');
    } catch (error) {
      if (error instanceof ApiError) {
        formError = error.message;
      } else {
        formError = 'ネットワークエラーが発生しました。しばらく経ってから再試行してください';
      }
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="mx-auto max-w-md px-4 py-8">
  <h1 class="text-2xl font-bold text-gray-800">ユーザー登録</h1>

  {#if !isSuccess}
    <!-- novalidate でネイティブバリデーションを無効化し、カスタムバリデーションの日本語メッセージを優先する -->
    <form class="mt-6 space-y-4" novalidate onsubmit={handleSubmit}>
      <!-- フォーム共通エラー（API エラー・ネットワークエラー） -->
      {#if formError}
        <div
          id="form-error"
          role="alert"
          class="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {formError}
        </div>
      {/if}

      <!-- ユーザー名入力 -->
      <div>
        <label for="username" class="block text-sm font-medium text-gray-700"> ユーザー名 </label>
        <input
          id="username"
          type="text"
          bind:value={username}
          autocomplete="username"
          required
          aria-invalid={usernameError ? 'true' : undefined}
          aria-describedby={usernameError ? 'username-error' : undefined}
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
        {#if usernameError}
          <p id="username-error" class="mt-1 text-sm text-red-600">{usernameError}</p>
        {/if}
      </div>

      <!-- メールアドレス入力 -->
      <div>
        <label for="email" class="block text-sm font-medium text-gray-700"> メールアドレス </label>
        <input
          id="email"
          type="email"
          bind:value={email}
          autocomplete="email"
          required
          aria-invalid={emailError ? 'true' : undefined}
          aria-describedby={emailError ? 'email-error' : undefined}
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
        {#if emailError}
          <p id="email-error" class="mt-1 text-sm text-red-600">{emailError}</p>
        {/if}
      </div>

      <!-- パスワード入力 -->
      <div>
        <label for="password" class="block text-sm font-medium text-gray-700"> パスワード </label>
        <input
          id="password"
          type="password"
          bind:value={password}
          autocomplete="new-password"
          required
          aria-invalid={passwordError ? 'true' : undefined}
          aria-describedby={passwordError ? 'password-error' : undefined}
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
        {#if passwordError}
          <p id="password-error" class="mt-1 text-sm text-red-600">{passwordError}</p>
        {/if}
      </div>

      <!-- 登録ボタン -->
      <button
        type="submit"
        disabled={isSubmitting}
        class="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? '登録中...' : '登録'}
      </button>
    </form>
  {:else}
    <!-- 登録完了画面 -->
    <div
      role="status"
      class="mt-6 rounded-md border border-green-200 bg-green-50 px-6 py-8 text-center"
    >
      <p class="text-lg font-semibold text-green-800">確認メールを送信しました</p>
      <p class="mt-2 text-sm text-green-700">
        ご登録のメールアドレスに確認メールをお送りしました。<br />
        メール内のリンクをクリックして登録を完了してください。
      </p>
    </div>
  {/if}
  <!-- T7: ログイン画面への導線リンク -->
</div>
