<script lang="ts">
  import { page } from '$app/state';
  import { ApiError } from '$lib/api/errors';
  import { getGameSession } from '$lib/api/game';
  import { getGameModeConfig } from '$lib/game/modes';
  import { normalizeGameSessionIdParam } from '$lib/game/session-result';
  import { authStore } from '$lib/stores/auth.svelte';
  import { gameSessionResultStore } from '$lib/stores/game-session-result.svelte';
  import type { GameSessionResponse, GameSessionResultItem } from '$lib/game/types';

  type RestoreStatus = 'idle' | 'loading' | 'empty' | 'unauthenticated' | 'error';

  type RestoredGameSessionResult = {
    userId: string;
    result: GameSessionResponse;
  };

  const sessionId = $derived(normalizeGameSessionIdParam(page.url.searchParams.get('sessionId')));
  const userId = $derived(authStore.user?.id ?? null);
  const accessToken = $derived(authStore.accessToken);
  let restoredResult = $state<RestoredGameSessionResult | null>(null);
  let restoreStatus = $state<RestoreStatus>('idle');
  let restoreMessage = $state<string | null>(null);
  let retryCount = $state(0);
  let activeRequestKey: string | null = null;
  const storedResult = $derived(
    gameSessionResultStore.matches(sessionId, userId) ? gameSessionResultStore.result : null
  );
  const apiResult = $derived(
    sessionId !== null &&
      userId !== null &&
      restoredResult?.userId === userId &&
      restoredResult.result.sessionId === sessionId
      ? restoredResult.result
      : null
  );
  const result = $derived(storedResult ?? apiResult);
  const modeConfig = $derived(result === null ? null : getGameModeConfig(result.mode));
  const isRestoreLoading = $derived(
    result === null &&
      sessionId !== null &&
      (authStore.isInitializing || restoreStatus === 'loading')
  );
  const unavailableTitle = $derived(getUnavailableTitle());
  const unavailableMessage = $derived(getUnavailableMessage());
  const unavailableRole = $derived(restoreStatus === 'error' ? 'alert' : 'status');
  const unavailableAriaLive = $derived(restoreStatus === 'error' ? 'assertive' : 'polite');
  const accuracy = $derived(
    result === null || result.totalCount === 0
      ? 0
      : Math.round((result.correctCount / result.totalCount) * 100)
  );
  const missedResults = $derived(result?.results.filter((item) => !item.isCorrect) ?? []);
  const replayHref = $derived(result === null ? '/game' : `/game/play?mode=${result.mode}`);

  $effect(() => {
    const currentSessionId = sessionId;
    const currentUserId = userId;
    const currentAccessToken = accessToken;
    const currentRetryCount = retryCount;

    if (result !== null) {
      restoreStatus = 'idle';
      restoreMessage = null;
      activeRequestKey = null;
      return;
    }

    if (currentSessionId === null) {
      restoreStatus = 'empty';
      restoreMessage = null;
      activeRequestKey = null;
      return;
    }

    if (authStore.isInitializing) {
      restoreStatus = 'loading';
      restoreMessage = null;
      activeRequestKey = null;
      return;
    }

    if (!authStore.isLoggedIn || currentUserId === null || currentAccessToken === null) {
      restoreStatus = 'unauthenticated';
      restoreMessage = null;
      activeRequestKey = null;
      return;
    }

    const requestKey = `${currentUserId}:${currentSessionId}:${currentAccessToken}:${currentRetryCount}`;
    if (activeRequestKey === requestKey) {
      return;
    }

    const controller = new AbortController();
    activeRequestKey = requestKey;
    restoreStatus = 'loading';
    restoreMessage = null;

    getGameSession({
      sessionId: currentSessionId,
      accessToken: currentAccessToken,
      signal: controller.signal
    })
      .then((session) => {
        if (controller.signal.aborted) {
          return;
        }

        gameSessionResultStore.set(session, currentUserId);
        restoredResult = { userId: currentUserId, result: session };
        restoreStatus = 'idle';
        restoreMessage = null;
        activeRequestKey = null;
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        restoreStatus = 'error';
        restoreMessage =
          error instanceof ApiError ? error.message : 'ゲーム結果の取得に失敗しました';
        activeRequestKey = null;
      });

    return () => {
      controller.abort();
      if (activeRequestKey === requestKey) {
        activeRequestKey = null;
      }
    };
  });

  function retryRestore(): void {
    activeRequestKey = null;
    retryCount += 1;
  }

  function getUnavailableTitle(): string {
    if (isRestoreLoading) {
      return '結果を読み込んでいます';
    }

    if (restoreStatus === 'unauthenticated') {
      return 'ログインが必要です';
    }

    if (restoreStatus === 'error') {
      return '結果を取得できませんでした';
    }

    return '結果を表示できません';
  }

  function getUnavailableMessage(): string {
    if (isRestoreLoading) {
      return 'ゲーム結果を読み込んでいます。';
    }

    if (restoreStatus === 'unauthenticated') {
      return '結果を復元するにはログインしてください。';
    }

    if (restoreStatus === 'error') {
      return restoreMessage ?? 'ゲーム結果の取得に失敗しました。';
    }

    if (sessionId === null) {
      return 'ゲーム結果を表示するためのセッションIDがありません。もう一度ゲームを開始してください。';
    }

    return 'ゲーム結果を表示できません。もう一度ゲームを開始してください。';
  }

  function formatPlayedAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function getResultLabel(item: GameSessionResultItem): string {
    if (item.chosenChoiceId === null) {
      return '時間切れ';
    }

    return item.isCorrect ? '正解' : '不正解';
  }

  function getResultClass(item: GameSessionResultItem): string {
    return item.isCorrect
      ? 'border-success-border bg-success-surface text-success-text'
      : 'border-danger-border bg-danger-surface text-danger-text-strong';
  }

  function getChosenChoiceLabel(item: GameSessionResultItem): string {
    return item.yourAnswer ?? '未回答';
  }

  function getCorrectChoiceLabel(item: GameSessionResultItem): string {
    return item.correctAnswer;
  }
</script>

<div class="space-y-6">
  {#if result === null || modeConfig === null}
    <section
      class="border-border-muted bg-surface space-y-4 rounded border p-6"
      aria-busy={isRestoreLoading}
      aria-live={unavailableAriaLive}
      role={unavailableRole}
    >
      <div>
        <p class="text-text-subtle text-sm font-semibold">4択クイズ</p>
        <div class="mt-2 flex items-center gap-3">
          {#if isRestoreLoading}
            <span
              class="border-brand inline-block h-5 w-5 animate-spin rounded border-2 border-t-transparent"
              aria-hidden="true"
            ></span>
          {/if}
          <h1 class="text-text text-2xl font-bold">{unavailableTitle}</h1>
        </div>
        <p class="text-text-muted mt-2 text-sm leading-6">{unavailableMessage}</p>
      </div>
      <div class="flex flex-wrap gap-3">
        {#if restoreStatus === 'error'}
          <button
            type="button"
            onclick={retryRestore}
            class="bg-action hover:bg-action-hover focus-visible:outline-focus text-text-inverse inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isRestoreLoading}
          >
            再試行
          </button>
        {/if}
        {#if restoreStatus === 'unauthenticated'}
          <a
            href="/login"
            class="bg-action hover:bg-action-hover focus-visible:outline-focus text-text-inverse inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            ログインへ
          </a>
        {:else}
          <a
            href={replayHref}
            class="bg-action hover:bg-action-hover focus-visible:outline-focus text-text-inverse inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            ゲームへ戻る
          </a>
        {/if}
        <a
          href="/"
          class="border-border text-text hover:bg-surface-muted focus-visible:outline-focus inline-flex items-center justify-center rounded border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          ホームへ
        </a>
      </div>
    </section>
  {:else}
    <section class="space-y-5">
      <div class="space-y-2">
        <p class="text-text-subtle text-sm font-semibold">4択クイズ</p>
        <h1 class="text-text text-2xl font-bold">ゲーム結果</h1>
        <p class="text-text-muted text-sm">
          {modeConfig.title} / {modeConfig.difficultyLabel} / {formatPlayedAt(result.playedAt)}
        </p>
      </div>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="border-border-muted bg-surface rounded border p-4">
          <p class="text-text-muted text-sm">スコア</p>
          <p class="text-text mt-1 text-2xl font-bold">{result.totalScore}</p>
        </div>
        <div class="border-border-muted bg-surface rounded border p-4">
          <p class="text-text-muted text-sm">正解数</p>
          <p class="text-text mt-1 text-2xl font-bold">
            {result.correctCount} / {result.totalCount}
          </p>
        </div>
        <div class="border-border-muted bg-surface rounded border p-4">
          <p class="text-text-muted text-sm">正答率</p>
          <p class="text-text mt-1 text-2xl font-bold">{accuracy}%</p>
        </div>
        <div class="border-border-muted bg-surface rounded border p-4">
          <p class="text-text-muted text-sm">最大連続正解</p>
          <p class="text-text mt-1 text-2xl font-bold">{result.maxStreak}</p>
        </div>
      </div>

      <div class="flex flex-wrap gap-3">
        <a
          href={replayHref}
          class="bg-action hover:bg-action-hover focus-visible:outline-focus text-text-inverse inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          もう一度
        </a>
        <a
          href="/game"
          class="border-border text-text hover:bg-surface-muted focus-visible:outline-focus inline-flex items-center justify-center rounded border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          モード選択へ戻る
        </a>
      </div>
    </section>

    <section class="space-y-3" aria-labelledby="game-result-detail-heading">
      <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="game-result-detail-heading" class="text-text text-lg font-bold">回答詳細</h2>
        <p class="text-text-muted text-sm">所要時間: {result.durationSec}秒</p>
      </div>

      <ol class="space-y-3">
        {#each result.results as item, index (item.questionId)}
          <li class={`rounded border px-4 py-3 ${getResultClass(item)}`}>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p class="text-sm font-semibold">第{index + 1}問: {getResultLabel(item)}</p>
                <p class="mt-1 text-xl font-bold break-words">{item.prompt}</p>
              </div>
              <p class="text-sm font-bold">{item.score}点</p>
            </div>
            <dl class="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt class="font-semibold">あなたの回答</dt>
                <dd class="mt-1">{getChosenChoiceLabel(item)}</dd>
              </div>
              <div>
                <dt class="font-semibold">正解</dt>
                <dd class="mt-1">{getCorrectChoiceLabel(item)}</dd>
              </div>
              <div>
                <dt class="font-semibold">回答時間</dt>
                <dd class="mt-1">{item.answerTimeSec}秒</dd>
              </div>
            </dl>
          </li>
        {/each}
      </ol>
    </section>

    <section class="space-y-3" aria-labelledby="game-result-missed-heading">
      <h2 id="game-result-missed-heading" class="text-text text-lg font-bold">復習ポイント</h2>
      {#if missedResults.length === 0}
        <div
          class="border-success-border bg-success-surface text-success-text rounded border px-4 py-3 text-sm"
        >
          全問正解です。このモードをもう一度解くか、別のモードに進みましょう。
        </div>
      {:else}
        <ul class="space-y-2">
          {#each missedResults as item (item.questionId)}
            <li
              class="border-danger-border bg-danger-surface text-danger-text-strong rounded border px-4 py-3 text-sm"
            >
              <span class="font-semibold">{item.prompt}</span>
              <span> は {getResultLabel(item)}。正解は {getCorrectChoiceLabel(item)} です。</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>
