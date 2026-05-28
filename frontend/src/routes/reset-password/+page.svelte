<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto, replaceState } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.svelte';
  import { validatePassword } from '$lib/validation/password';

  // フォーム入力値
  let password = $state('');
  let confirmPassword = $state('');

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
    replaceState(cleanUrl.pathname + cleanUrl.search + cleanUrl.hash, page.state);
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
</script>

<div class="mx-auto max-w-md px-4 py-8">
  <h1 class="text-2xl font-bold text-gray-800">パスワードリセット</h1>
  <p class="mt-2 text-gray-600">
    新しいパスワードを設定する画面です。送信処理とバリデーションは次のタスクで実装します。
  </p>

  {#if formError}
    <div
      role="alert"
      class="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      {formError}
    </div>
  {/if}

  <div class="mt-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
    <p class="text-sm text-gray-500">準備中の state を定義済みです。</p>
  </div>
</div>
