<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { goto, replaceState } from '$app/navigation';
  import { API_BASE_URL } from '$lib/api/config';
  import { ApiError, parseErrorResponse } from '$lib/api/errors';
  import { toastStore } from '$lib/stores/toast.svelte';

  type VerifyStatus = 'verifying' | 'success' | 'error';

  let status = $state<VerifyStatus>('verifying');
  let errorMessage = $state<string | null>(null);
  let alreadyVerified = $state(false);

  // リダイレクトまでのカウントダウン秒数（1 箇所で管理して setTimeout の ms との不整合を防ぐ）
  const REDIRECT_SECONDS = 3;
  let countdown = $state(REDIRECT_SECONDS);

  // 「既に認証済み」を判定する定数（バックエンドのメッセージと一致させる）
  const ALREADY_VERIFIED_MESSAGE = '既にメールアドレスは確認済みです';

  // onMount で一度だけ URL から読み取ったトークンを保持（再試行に備える）
  let storedToken = $state<string | null>(null);

  // タイマー ID（onMount の cleanup 関数からも参照するためコンポーネントスコープに置く）
  let redirectTimerId: ReturnType<typeof setTimeout> | null = null;
  let countdownIntervalId: ReturnType<typeof setInterval> | null = null;

  // 多重実行ガードフラグ
  let isVerifying = false;

  // 競合する古い非同期結果を無視するための連番
  let verifyRequestId = 0;

  function getPageState(): Record<string, unknown> {
    if (typeof page.state === 'object' && page.state !== null) {
      return page.state as Record<string, unknown>;
    }
    return {};
  }

  async function setPageState(
    patch: Record<string, unknown>,
    options: { removeVerifyToken?: boolean } = {}
  ): Promise<void> {
    await tick();

    const currentState = getPageState();
    const cleanUrl = new URL(page.url);
    cleanUrl.searchParams.delete('token');
    const baseState = options.removeVerifyToken
      ? (() => {
          const rest = { ...currentState };
          delete rest.verifyEmailToken;
          return rest;
        })()
      : currentState;

    replaceState(cleanUrl.pathname + cleanUrl.search + cleanUrl.hash, {
      ...baseState,
      ...patch
    });
  }

  function startCountdownAndRedirect() {
    // 既存タイマーをクリアしてから再設定する（多重起動防止）
    if (countdownIntervalId !== null) {
      clearInterval(countdownIntervalId);
      countdownIntervalId = null;
    }
    if (redirectTimerId !== null) {
      clearTimeout(redirectTimerId);
      redirectTimerId = null;
    }
    countdown = REDIRECT_SECONDS;
    countdownIntervalId = setInterval(() => {
      if (countdown <= 1 && countdownIntervalId !== null) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
      } else {
        countdown -= 1;
      }
    }, 1000);
    redirectTimerId = setTimeout(() => {
      goto('/login');
    }, REDIRECT_SECONDS * 1000);
  }

  async function verify() {
    // storedToken が null の場合は何もしない（onMount のガードで事前に弾く）
    if (!storedToken) return;
    // すでに成功表示になっている場合は再実行しない
    if (status === 'success') return;
    // 多重実行ガード（再試行ボタン連打等で並行 fetch が走るのを防ぐ）
    if (isVerifying) return;
    isVerifying = true;
    const currentRequestId = ++verifyRequestId;

    status = 'verifying';
    errorMessage = null;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken })
      });

      if (!response.ok) {
        await parseErrorResponse(response);
      }

      // 後から開始されたリクエストがある場合は古い結果を破棄
      if (currentRequestId !== verifyRequestId) {
        return;
      }

      // 通常成功
      status = 'success';
      alreadyVerified = false;
      await setPageState(
        {
          verifyEmailCompleted: true,
          verifyEmailAlreadyVerified: false
        },
        { removeVerifyToken: true }
      );
      toastStore.success('メール認証が完了しました！');
      startCountdownAndRedirect();
    } catch (error) {
      // 後から開始されたリクエストがある場合は古い結果を破棄
      if (currentRequestId !== verifyRequestId) {
        return;
      }

      // ApiError でも fetch 例外でも一律 ApiError として扱う
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(0, '通信に失敗しました。ネットワーク接続を確認してください。');

      // 「既に認証済み」は success として扱う（T3）
      if (apiError.status === 400 && apiError.message === ALREADY_VERIFIED_MESSAGE) {
        status = 'success';
        alreadyVerified = true;
        await setPageState(
          {
            verifyEmailCompleted: true,
            verifyEmailAlreadyVerified: true
          },
          { removeVerifyToken: true }
        );
        toastStore.info('既にメール認証が完了しています');
        startCountdownAndRedirect();
        return;
      }

      // それ以外はエラー
      status = 'error';
      errorMessage = apiError.message;
      toastStore.fromApiError(apiError);
    } finally {
      if (currentRequestId === verifyRequestId) {
        isVerifying = false;
      }
    }
  }

  onMount(() => {
    const currentState = getPageState();

    // 直前に成功済みの履歴状態があれば、再検証せず成功表示を維持する
    if (currentState.verifyEmailCompleted === true) {
      status = 'success';
      alreadyVerified = currentState.verifyEmailAlreadyVerified === true;
      startCountdownAndRedirect();
      return () => {
        if (redirectTimerId !== null) clearTimeout(redirectTimerId);
        if (countdownIntervalId !== null) clearInterval(countdownIntervalId);
      };
    }

    // 1. トークン取得 + ガード
    const queryToken = page.url.searchParams.get('token');
    const stateToken =
      typeof currentState.verifyEmailToken === 'string' ? currentState.verifyEmailToken : null;
    const rawToken = queryToken ?? stateToken;
    if (!rawToken) {
      status = 'error';
      errorMessage = '認証リンクが無効です。メール内のリンクから再度アクセスしてください。';
      return;
    }

    // 2. トークンをコンポーネントスコープ変数に保持（再試行に備える）
    storedToken = rawToken;

    // 3. トークンを URL から除去（取得直後・fetch 前。トークンは storedToken で保持）
    //    onMount 直後は SvelteKit router が未初期化の場合があるため、tick() で 1 ティック待ってから
    //    replaceState を呼ぶ。これを外すと router 初期化前エラーが再発する。
    //    hash も保持して URL が意図せず変わらないようにする
    if (queryToken) {
      const cleanUrl = new URL(page.url);
      cleanUrl.searchParams.delete('token');
      void (async () => {
        await tick();

        // 先に成功状態へ遷移している場合は上書きしない
        const latestState = getPageState();
        if (latestState.verifyEmailCompleted === true) {
          return;
        }

        replaceState(cleanUrl.pathname + cleanUrl.search + cleanUrl.hash, {
          ...latestState,
          verifyEmailToken: rawToken,
          verifyEmailCompleted: false,
          verifyEmailAlreadyVerified: false
        });
      })();
    }

    // 4. 認証処理を開始
    void verify();

    // クリーンアップ
    return () => {
      verifyRequestId += 1;
      isVerifying = false;
      if (redirectTimerId !== null) clearTimeout(redirectTimerId);
      if (countdownIntervalId !== null) clearInterval(countdownIntervalId);
    };
  });
</script>

<div class="mx-auto max-w-md px-4 py-8">
  <h1 class="text-text text-2xl font-bold">メール認証</h1>

  <div class="border-border-muted bg-surface mt-6 rounded-lg border p-6 shadow-sm">
    {#if status === 'verifying'}
      <div role="status" aria-live="polite" class="flex flex-col items-center gap-4 py-8">
        <!-- スピナー -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="text-action h-12 w-12 animate-spin"
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
        <p class="text-text">認証中です。しばらくお待ちください...</p>
      </div>
    {:else if status === 'success'}
      <div
        role="status"
        aria-live="polite"
        class="flex flex-col items-center gap-4 py-4 text-center"
      >
        <!-- チェックマーク（緑） -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="text-success-icon h-12 w-12"
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
        <p class="text-text text-lg font-medium">
          {alreadyVerified ? '既にメール認証が完了しています' : 'メール認証が完了しました！'}
        </p>
        <p class="text-text-subtle text-sm">{countdown}秒後にログイン画面に移動します</p>
        <a
          href="/login"
          class="bg-action text-text-inverse hover:bg-action-hover focus:ring-focus rounded-md px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none"
        >
          今すぐログイン
        </a>
      </div>
    {:else}
      <div role="alert" class="flex flex-col items-center gap-4 py-4 text-center">
        <!-- エラーアイコン（赤） -->
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="text-danger-icon h-12 w-12"
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
        <p class="text-text text-lg font-medium">認証に失敗しました</p>
        <p class="text-danger-text text-sm">{errorMessage}</p>
        <div class="flex flex-col gap-2 sm:flex-row">
          {#if storedToken}
            <button
              type="button"
              onclick={verify}
              class="bg-action text-text-inverse hover:bg-action-hover focus:ring-focus rounded-md px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none"
            >
              再試行する
            </button>
          {/if}
          <a
            href="/register"
            class="border-border text-text hover:bg-surface-muted focus:ring-focus rounded-md border px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none"
          >
            再度ユーザー登録する
          </a>
          <a
            href="/login"
            class="border-border text-text hover:bg-surface-muted focus:ring-focus rounded-md border px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none"
          >
            ログイン画面へ
          </a>
        </div>
      </div>
    {/if}
  </div>
</div>
