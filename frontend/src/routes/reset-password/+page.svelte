<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { goto, replaceState } from '$app/navigation';
  import { API_BASE_URL } from '$lib/api/config';
  import { ApiError, parseErrorResponse } from '$lib/api/errors';
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { PASSWORD_BYTE_LIMIT_HINT, validatePassword } from '$lib/validation/password';

  // フォーム入力値
  let password = $state('');
  let confirmPassword = $state('');
  let passwordInput = $state<HTMLInputElement>();
  let confirmPasswordInput = $state<HTMLInputElement>();

  // パスワード表示/非表示
  let showPassword = $state(false);

  // 送信状態
  let isSubmitting = $state(false);
  let isSuccess = $state(false);

  // エラー表示用
  let passwordError = $state<string | null>(null);
  let confirmPasswordError = $state<string | null>(null);
  let formError = $state<string | null>(null);

  // URL から取得して保持する token
  let storedToken = $state<string | null>(null);

  // 既にログイン済みならトップページにリダイレクト
  // 初期化中（refresh トークン検証中）は判定しない
  $effect(() => {
    if (!authStore.isInitializing && authStore.isLoggedIn) {
      goto('/');
    }
  });

  onMount(() => {
    const rawToken = page.url.searchParams.get('token');

    if (!rawToken) {
      formError = 'リセットリンクが無効です。メール内のリンクから再度アクセスしてください。';
      return;
    }

    storedToken = rawToken;

    const cleanUrl = new URL(page.url);
    cleanUrl.searchParams.delete('token');
    // onMount 直後は SvelteKit router が未初期化の場合があるため、tick() で 1 ティック待ってから
    // replaceState を呼ぶ。これを外すと router 初期化前エラーが再発する。
    void (async () => {
      await tick();
      replaceState(cleanUrl.pathname + cleanUrl.search + cleanUrl.hash, page.state);
    })();
  });

  /** trim 済みパスワードを受け取る */
  function validatePasswordField(value: string): string | null {
    return validatePassword(value);
  }

  /** trim 済みの password / confirmPassword を受け取り、一致判定する */
  function validateConfirmPasswordField(
    normalizedPassword: string,
    normalizedConfirmPassword: string
  ): string | null {
    if (!normalizedConfirmPassword) {
      return '確認用パスワードを入力してください';
    }

    if (normalizedPassword !== normalizedConfirmPassword) {
      return '確認用パスワードが一致しません';
    }

    return null;
  }

  async function focusFirstInvalidField(): Promise<void> {
    await tick();
    const firstInvalidInput = passwordError
      ? passwordInput
      : confirmPasswordError
        ? confirmPasswordInput
        : null;
    firstInvalidInput?.focus();
  }

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    if (!storedToken) {
      formError ??= 'リセットリンクが無効です。メール内のリンクから再度アクセスしてください。';
      return;
    }

    const normalizedPassword = password.trim();
    const normalizedConfirmPassword = confirmPassword.trim();

    formError = null;
    passwordError = validatePasswordField(normalizedPassword);
    confirmPasswordError = validateConfirmPasswordField(
      normalizedPassword,
      normalizedConfirmPassword
    );

    if (passwordError || confirmPasswordError) {
      await focusFirstInvalidField();
      return;
    }

    isSubmitting = true;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token: storedToken, password: normalizedPassword })
      });

      if (!response.ok) {
        await parseErrorResponse(response);
      }

      password = '';
      confirmPassword = '';
      showPassword = false;
      isSuccess = true;
      toastStore.success('パスワードをリセットしました');
    } catch (error) {
      if (error instanceof ApiError) {
        formError = error.message;
      } else {
        formError = 'ネットワークエラーが発生しました。接続を確認してください';
      }
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="mx-auto max-w-md px-4 py-8">
  <h1 class="text-text text-2xl font-bold">パスワードリセット</h1>
  <p class="text-text-muted mt-2">新しいパスワードを入力して再設定してください。</p>

  {#if !isSuccess}
    <form class="mt-6 space-y-4" novalidate onsubmit={handleSubmit}>
      {#if formError}
        <div
          id="form-error"
          role="alert"
          class="border-danger-border bg-danger-surface text-danger-text rounded-md border px-4 py-3 text-sm"
        >
          {formError}
        </div>
      {/if}

      <div>
        <label for="password" class="text-text block text-sm font-medium"> 新しいパスワード </label>
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

      <div>
        <label for="confirm-password" class="text-text block text-sm font-medium">
          確認用パスワード
        </label>
        <input
          id="confirm-password"
          type={showPassword ? 'text' : 'password'}
          bind:value={confirmPassword}
          bind:this={confirmPasswordInput}
          autocomplete="new-password"
          required
          aria-invalid={confirmPasswordError ? 'true' : undefined}
          aria-describedby={confirmPasswordError ? 'confirm-password-error' : undefined}
          class="border-border focus:border-focus focus:ring-focus mt-1 w-full rounded-md border px-3 py-2 focus:ring-1 focus:outline-none"
        />
        {#if confirmPasswordError}
          <p id="confirm-password-error" class="text-danger-text mt-1 text-sm">
            {confirmPasswordError}
          </p>
        {/if}
      </div>

      <button
        type="submit"
        disabled={isSubmitting || !storedToken}
        class="bg-action text-text-inverse hover:bg-action-hover focus:ring-focus w-full rounded-md px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? '送信中...' : 'パスワードを再設定する'}
      </button>
    </form>
  {:else}
    <div
      role="status"
      class="border-success-border bg-success-surface mt-6 rounded-md border px-6 py-8 text-center"
    >
      <p class="text-success-text text-lg font-semibold">パスワードをリセットしました</p>
      <p class="text-success-text mt-2 text-sm">
        新しいパスワードでログインしてください。他の端末でも再度ログインが必要です。
      </p>
      <a
        href="/login"
        class="bg-action text-text-inverse hover:bg-action-hover focus:ring-focus mt-4 inline-flex rounded-md px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none"
      >
        ログイン画面へ
      </a>
    </div>
  {/if}
</div>
