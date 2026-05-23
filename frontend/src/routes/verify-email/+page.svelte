<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { API_BASE_URL } from '$lib/api/config';
  import { ApiError } from '$lib/api/errors';
  import { toastStore } from '$lib/stores/toast.svelte';

  type VerifyStatus = 'verifying' | 'success' | 'error';

  let status = $state<VerifyStatus>('verifying');
  let errorMessage = $state<string | null>(null);
  let alreadyVerified = $state(false);
  let countdown = $state(3);

  // 「既に認証済み」を判定する定数（バックエンドのメッセージと一致させる）
  const ALREADY_VERIFIED_MESSAGE = '既にメールアドレスは確認済みです';

  onMount(() => {
    let redirectTimerId: ReturnType<typeof setTimeout> | null = null;
    let countdownIntervalId: ReturnType<typeof setInterval> | null = null;

    async function verify() {
      // 1. トークン取得 + ガード
      const token = page.url.searchParams.get('token');
      if (!token) {
        status = 'error';
        errorMessage = '認証リンクが無効です。メール内のリンクから再度アクセスしてください。';
        return;
      }

      // 2. API 呼び出し
      try {
        const response = await fetch(`${API_BASE_URL}/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token })
        });

        if (!response.ok) {
          let errorBody: { error?: string; details?: { message: string }[] } | null = null;
          try {
            errorBody = await response.json();
          } catch {
            // 非 JSON レスポンス（502/504 等）
          }
          const message =
            errorBody?.details?.[0]?.message ?? errorBody?.error ?? 'エラーが発生しました';
          throw new ApiError(response.status, message, errorBody);
        }

        await response.json();

        // 3a. 通常成功
        status = 'success';
        alreadyVerified = false;
        toastStore.success('メール認証が完了しました！');
        startCountdownAndRedirect();
      } catch (error) {
        // ApiError でも fetch 例外でも一律 ApiError として扱う
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError(0, '通信に失敗しました。ネットワーク接続を確認してください。');

        // 3b. 「既に認証済み」は success として扱う（T3）
        if (apiError.status === 400 && apiError.message === ALREADY_VERIFIED_MESSAGE) {
          status = 'success';
          alreadyVerified = true;
          toastStore.info('既にメール認証が完了しています');
          startCountdownAndRedirect();
          return;
        }

        // 3c. それ以外はエラー
        status = 'error';
        errorMessage = apiError.message;
        toastStore.fromApiError(apiError);
      }
    }

    function startCountdownAndRedirect() {
      countdownIntervalId = setInterval(() => {
        countdown -= 1;
        if (countdown <= 0 && countdownIntervalId !== null) {
          clearInterval(countdownIntervalId);
          countdownIntervalId = null;
        }
      }, 1000);
      redirectTimerId = setTimeout(() => {
        goto('/login');
      }, 3000);
    }

    verify();

    // クリーンアップ（T4）
    return () => {
      if (redirectTimerId !== null) clearTimeout(redirectTimerId);
      if (countdownIntervalId !== null) clearInterval(countdownIntervalId);
    };
  });
</script>

<div class="mx-auto max-w-md px-4 py-8">
  <h1 class="text-2xl font-bold text-gray-800">メール認証</h1>

  <div class="mt-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
    {#if status === 'verifying'}
      <div role="status" aria-live="polite" class="flex flex-col items-center gap-4 py-8">
        <!-- スピナー -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-12 w-12 animate-spin text-blue-600"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
          ></circle>
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          ></path>
        </svg>
        <p class="text-gray-700">認証中です。しばらくお待ちください...</p>
      </div>
    {:else if status === 'success'}
      <div class="flex flex-col items-center gap-4 py-4 text-center">
        <!-- チェックマーク（緑） -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-12 w-12 text-green-500"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clip-rule="evenodd"
          />
        </svg>
        <p class="text-lg font-medium text-gray-800">
          {alreadyVerified ? '既にメール認証が完了しています' : 'メール認証が完了しました！'}
        </p>
        <p class="text-sm text-gray-500">{countdown}秒後にログイン画面に移動します</p>
        <a
          href="/login"
          class="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
        >
          今すぐログイン
        </a>
      </div>
    {:else}
      <div role="alert" class="flex flex-col items-center gap-4 py-4 text-center">
        <!-- エラーアイコン（赤） -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-12 w-12 text-red-500"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
            clip-rule="evenodd"
          />
        </svg>
        <p class="text-lg font-medium text-gray-800">認証に失敗しました</p>
        <p class="text-sm text-red-700">{errorMessage}</p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <a
            href="/register"
            class="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
          >
            再度ユーザー登録する
          </a>
          <a
            href="/login"
            class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
          >
            ログイン画面へ
          </a>
        </div>
      </div>
    {/if}
  </div>
</div>
