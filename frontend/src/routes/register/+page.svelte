<script lang="ts">
  import { tick } from 'svelte';
  import { API_BASE_URL } from '$lib/api/config';
  import { ApiError, parseErrorResponse } from '$lib/api/errors';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { PASSWORD_BYTE_LIMIT_HINT } from '$lib/validation/password';
  import { validateUsername, validateEmail, validatePassword } from './validation';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.svelte';

  // フォーム入力値
  let username = $state('');
  let email = $state('');
  let password = $state('');
  let usernameInput = $state<HTMLInputElement>();
  let emailInput = $state<HTMLInputElement>();
  let passwordInput = $state<HTMLInputElement>();

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

  async function focusFirstInvalidField(): Promise<void> {
    await tick();
    const firstInvalidInput = usernameError
      ? usernameInput
      : emailError
        ? emailInput
        : passwordError
          ? passwordInput
          : null;
    firstInvalidInput?.focus();
  }

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
    const normalizedPassword = password.trim(); // バックエンドの normalizePassword と同じく先頭/末尾スペースを除去する（内部スペースは validatePassword で弾く）

    // フォーム共通エラーをクリア（前回の API エラーをバリデーション途中でも残さない）
    formError = null;

    // フィールドごとにバリデーションを実行し、エラーを state にセットする
    usernameError = validateUsername(normalizedUsername);
    emailError = validateEmail(normalizedEmail);
    passwordError = validatePassword(normalizedPassword);

    if (usernameError || emailError || passwordError) {
      await focusFirstInvalidField();
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
        await parseErrorResponse(response);
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
  <h1 class="text-text text-2xl font-bold">ユーザー登録</h1>

  {#if !isSuccess}
    <!-- novalidate でネイティブバリデーションを無効化し、カスタムバリデーションの日本語メッセージを優先する -->
    <form class="mt-6 space-y-4" novalidate onsubmit={handleSubmit}>
      <!-- フォーム共通エラー（API エラー・ネットワークエラー） -->
      {#if formError}
        <div
          id="form-error"
          role="alert"
          class="border-danger-border bg-danger-surface text-danger-text rounded-md border px-4 py-3 text-sm"
        >
          {formError}
        </div>
      {/if}

      <!-- ユーザー名入力 -->
      <div>
        <label for="username" class="text-text block text-sm font-medium"> ユーザー名 </label>
        <input
          id="username"
          type="text"
          bind:value={username}
          bind:this={usernameInput}
          autocomplete="username"
          required
          aria-invalid={usernameError ? 'true' : undefined}
          aria-describedby={usernameError ? 'username-error' : undefined}
          class="border-border focus:border-focus focus:ring-focus mt-1 w-full rounded-md border px-3 py-2 focus:ring-1 focus:outline-none"
        />
        {#if usernameError}
          <p id="username-error" class="text-danger-text mt-1 text-sm">{usernameError}</p>
        {/if}
      </div>

      <!-- メールアドレス入力 -->
      <div>
        <label for="email" class="text-text block text-sm font-medium"> メールアドレス </label>
        <input
          id="email"
          type="email"
          bind:value={email}
          bind:this={emailInput}
          autocomplete="email"
          required
          aria-invalid={emailError ? 'true' : undefined}
          aria-describedby={emailError ? 'email-error' : undefined}
          class="border-border focus:border-focus focus:ring-focus mt-1 w-full rounded-md border px-3 py-2 focus:ring-1 focus:outline-none"
        />
        {#if emailError}
          <p id="email-error" class="text-danger-text mt-1 text-sm">{emailError}</p>
        {/if}
      </div>

      <!-- パスワード入力 -->
      <div>
        <label for="password" class="text-text block text-sm font-medium"> パスワード </label>
        <div class="relative mt-1">
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            bind:value={password}
            bind:this={passwordInput}
            autocomplete="new-password"
            required
            aria-invalid={passwordError ? 'true' : undefined}
            aria-describedby={passwordError ? 'password-hint password-error' : 'password-hint'}
            class="border-border focus:border-focus focus:ring-focus w-full rounded-md border px-3 py-2 pr-10 focus:ring-1 focus:outline-none"
          />
          <button
            type="button"
            onclick={() => (showPassword = !showPassword)}
            aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示する'}
            class="text-text-disabled hover:text-text-muted focus:ring-focus absolute inset-y-0 right-0 flex items-center rounded-md pr-3 focus:ring-2 focus:ring-offset-2 focus:outline-none"
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
        <p id="password-hint" class="text-text-muted mt-1 text-sm">
          {PASSWORD_BYTE_LIMIT_HINT}
        </p>
        {#if passwordError}
          <p id="password-error" class="text-danger-text mt-1 text-sm">{passwordError}</p>
        {/if}
      </div>

      <p class="text-text-muted text-sm">
        登録前に
        <a
          href="/privacy"
          class="text-action-text focus:ring-focus rounded-sm hover:underline focus:ring-2 focus:ring-offset-2 focus:outline-none"
        >
          プライバシーポリシー
        </a>
        をご確認ください。
      </p>

      <!-- 登録ボタン -->
      <button
        type="submit"
        disabled={isSubmitting}
        class="bg-action text-text-inverse hover:bg-action-hover focus:ring-focus w-full rounded-md px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? '登録中...' : '登録'}
      </button>
    </form>
  {:else}
    <!-- 登録完了画面 -->
    <div
      role="status"
      class="border-success-border bg-success-surface mt-6 rounded-md border px-6 py-8 text-center"
    >
      <p class="text-success-text text-lg font-semibold">確認メールを送信しました</p>
      <p class="text-success-text mt-2 text-sm">
        ご登録のメールアドレスに確認メールをお送りしました。<br />
        メール内のリンクをクリックして登録を完了してください。
      </p>
    </div>
  {/if}

  <!-- ログインページへの導線 -->
  <div class="mt-4 text-center text-sm">
    <span class="text-text-muted">すでにアカウントをお持ちの方は</span>
    <a href="/login" class="text-action hover:underline">ログイン</a>
  </div>
</div>
