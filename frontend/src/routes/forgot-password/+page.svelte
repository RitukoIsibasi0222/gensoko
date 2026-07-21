<script lang="ts">
  import { goto } from '$app/navigation';
  import { API_BASE_URL } from '$lib/api/config';
  import { ApiError, parseErrorResponse } from '$lib/api/errors';
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import { isValidEmailFormat } from '$lib/validation/email';

  // フォーム入力値
  let email = $state('');

  // 送信状態
  let isSubmitting = $state(false);
  let isSuccess = $state(false);

  // エラー表示用
  let emailError = $state<string | null>(null);
  let formError = $state<string | null>(null);

  // 既ログイン時はトップへリダイレクト
  $effect(() => {
    if (!authStore.isInitializing && authStore.isLoggedIn) {
      goto('/');
    }
  });

  /**
   * trim 済みメールアドレスを受け取り、入力エラーを返す
   */
  function validateEmail(value: string): string | null {
    if (!value) {
      return 'メールアドレスを入力してください';
    }

    if (!isValidEmailFormat(value)) {
      return '有効なメールアドレスを入力してください';
    }

    return null;
  }

  /**
   * パスワードリセット申請フォーム送信
   */
  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();

    // 多重送信防止
    if (isSubmitting) {
      return;
    }

    // 正規化値を一度だけ計算し、validate と fetch の両方で再利用する
    const normalizedEmail = email.trim();

    formError = null;
    emailError = validateEmail(normalizedEmail);
    if (emailError) {
      return;
    }

    isSubmitting = true;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: normalizedEmail })
      });

      // エラー時のみレスポンスボディを解析する
      if (!response.ok) {
        await parseErrorResponse(response);
      }

      isSuccess = true;
      toastStore.success('パスワードリセットメールを送信しました');
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
  <h1 class="text-text text-2xl font-bold">パスワードリセット申請</h1>

  {#if !isSuccess}
    <p class="text-text-muted mt-2">
      登録済みのメールアドレスを入力してください。パスワード再設定用の案内をお送りします。
    </p>

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
        <label for="email" class="text-text block text-sm font-medium">メールアドレス</label>
        <input
          id="email"
          type="email"
          bind:value={email}
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

      <button
        type="submit"
        disabled={isSubmitting}
        class="bg-action text-text-inverse hover:bg-action-hover focus:ring-focus w-full rounded-md px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? '送信中...' : '送信する'}
      </button>
    </form>
  {:else}
    <div
      role="status"
      class="border-success-border bg-success-surface mt-6 rounded-md border px-6 py-8 text-center"
    >
      <p class="text-success-text text-lg font-semibold">メール送信を受け付けました</p>
      <p class="text-success-text mt-2 text-sm">
        ご入力のメールアドレスが登録されている場合、パスワードリセット用のメールをお送りしました。<br
        />
        メールが届かない場合は、入力内容をご確認のうえ再度お試しください。
      </p>
    </div>
  {/if}

  <div class="mt-4 text-center text-sm">
    <a href="/login" class="text-action hover:underline">ログイン画面へ戻る</a>
  </div>
</div>
