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

  // パスワード表示/非表示フラグ
  let showPassword = $state(false);

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
    const normalizedPassword = password; // パスワードは trim しない（スペースを含む入力をそのままバリデーション・送信する）

    // フォーム共通エラーをクリア（前回の API エラーをバリデーション途中でも残さない）
    formError = null;

    // フィールドごとにバリデーションを実行し、エラーを state にセットする
    usernameError = validateUsername(normalizedUsername);
    emailError = validateEmail(normalizedEmail);
    passwordError = validatePassword(normalizedPassword);

    if (usernameError || emailError || passwordError) {
      return;
    }

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
        let errorBody: { error?: string; details?: { message: string }[] } | null = null;
        try {
          errorBody = await response.json();
        } catch {
          // JSON パース失敗時（502/504 等の非 JSON レスポンス）は null のまま
        }
        // details[0].message を優先（バリデーションエラー時の具体的なメッセージを使用）
        const message =
          errorBody?.details?.[0]?.message ?? errorBody?.error ?? 'エラーが発生しました';
        throw new ApiError(response.status, message, errorBody);
      }

      // 登録成功: パスワードをクリアしてから成功フラグを立てる（メモリ上に残さない）
      password = '';
      showPassword = false;
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
        <div class="relative mt-1">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            bind:value={password}
            autocomplete="new-password"
            required
            aria-invalid={passwordError ? 'true' : undefined}
            aria-describedby={passwordError ? 'password-error' : undefined}
            class="w-full rounded-md border border-gray-300 px-3 py-2 pr-10 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
          <button
            type="button"
            onclick={() => (showPassword = !showPassword)}
            aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示する'}
            class="absolute inset-y-0 right-0 flex items-center rounded-md pr-3 text-gray-400 hover:text-gray-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
          >
            {#if showPassword}
              <!-- eye-off: 表示中 → クリックで隠す -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fill-rule="evenodd"
                  d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z"
                  clip-rule="evenodd"
                />
                <path
                  d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z"
                />
              </svg>
            {:else}
              <!-- eye: 非表示中 → クリックで表示 -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path
                  fill-rule="evenodd"
                  d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                  clip-rule="evenodd"
                />
              </svg>
            {/if}
          </button>
        </div>
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

  <!-- ログインページへの導線 -->
  <div class="mt-4 text-center text-sm">
    <span class="text-gray-600">すでにアカウントをお持ちの方は</span>
    <a href="/login" class="text-blue-600 hover:underline">ログイン</a>
  </div>
</div>
