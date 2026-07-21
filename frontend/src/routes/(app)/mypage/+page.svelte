<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy } from 'svelte';
  import { ApiError } from '$lib/api/errors';
  import { getGameSessions } from '$lib/api/game';
  import { getMyStats, type MyStatsResponse } from '$lib/api/users';
  import AccuracyTrendChart from '$lib/components/mypage/AccuracyTrendChart.svelte';
  import StatsSummaryCards from '$lib/components/mypage/StatsSummaryCards.svelte';
  import { GAME_MODE_CONFIGS, getGameModeConfig } from '$lib/game/modes';
  import {
    DEFAULT_GAME_SESSION_HISTORY_LIMIT,
    formatGameSessionPlayedAt,
    getGameSessionAccuracy,
    normalizeGameSessionHistoryQuery
  } from '$lib/game/session-history';
  import type { GameMode, GameSessionHistoryItem, GameSessionHistoryQuery } from '$lib/game/types';
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';

  const NETWORK_ERROR_MESSAGE = 'ネットワークエラーが発生しました。接続を確認してください';

  type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

  let statsResponse = $state<MyStatsResponse | null>(null);
  let statsLoadStatus = $state<LoadStatus>('idle');
  let statsErrorMessage = $state<string | null>(null);
  let activeStatsAbortController: AbortController | null = null;
  let activeStatsRequestKey: string | null = null;
  let loadedStatsRequestKey: string | null = null;

  let sessions = $state<GameSessionHistoryItem[]>([]);
  let nextCursor = $state<string | null>(null);
  let appliedQuery = $state<GameSessionHistoryQuery>(
    normalizeGameSessionHistoryQuery({
      limit: page.url.searchParams.get('limit'),
      cursor: page.url.searchParams.get('cursor'),
      mode: page.url.searchParams.get('mode')
    })
  );
  let isInitialLoading = $state(true);
  let isLoadingMore = $state(false);
  let errorMessage = $state<string | null>(null);
  let lastRequestKey = '';
  let requestSequence = 0;
  let activeAbortController: AbortController | null = null;

  const hasSessions = $derived(sessions.length > 0);
  const selectedModeValue = $derived(appliedQuery.mode ?? '');
  const isStatsLoading = $derived(statsLoadStatus === 'loading');

  $effect(() => {
    if (authStore.isInitializing) return;

    if (!authStore.isLoggedIn || !authStore.accessToken) {
      resetStatsState();
      resetHistoryState();
      isInitialLoading = false;
      return;
    }

    void loadStats(authStore.accessToken, false, false);

    const nextQuery = normalizeGameSessionHistoryQuery({
      limit: page.url.searchParams.get('limit'),
      cursor: page.url.searchParams.get('cursor'),
      mode: page.url.searchParams.get('mode')
    });
    const requestKey = [
      authStore.accessToken,
      nextQuery.limit,
      nextQuery.cursor,
      nextQuery.mode
    ].join(':');
    if (requestKey === lastRequestKey) return;

    lastRequestKey = requestKey;
    appliedQuery = nextQuery;
    void loadHistory(nextQuery, false, false);
  });

  onDestroy(() => {
    activeStatsAbortController?.abort();
    activeAbortController?.abort();
  });

  function resetStatsState(): void {
    activeStatsAbortController?.abort();
    activeStatsAbortController = null;
    activeStatsRequestKey = null;
    loadedStatsRequestKey = null;
    statsResponse = null;
    statsLoadStatus = 'idle';
    statsErrorMessage = null;
  }

  function resetHistoryState(): void {
    activeAbortController?.abort();
    activeAbortController = null;
    lastRequestKey = '';
    sessions = [];
    nextCursor = null;
    errorMessage = null;
    isLoadingMore = false;
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  async function loadStats(accessToken: string, force: boolean, showToast: boolean): Promise<void> {
    const requestKey = accessToken;
    if (!force && (activeStatsRequestKey === requestKey || loadedStatsRequestKey === requestKey)) {
      return;
    }

    activeStatsAbortController?.abort();
    const abortController = new AbortController();
    activeStatsAbortController = abortController;
    activeStatsRequestKey = requestKey;

    if (force) {
      loadedStatsRequestKey = null;
    }

    statsLoadStatus = 'loading';
    statsErrorMessage = null;

    try {
      const response = await getMyStats({
        accessToken,
        signal: abortController.signal
      });

      if (abortController.signal.aborted || activeStatsRequestKey !== requestKey) {
        return;
      }

      statsResponse = response;
      statsLoadStatus = 'success';
      loadedStatsRequestKey = requestKey;
    } catch (error) {
      if (
        isAbortError(error) ||
        abortController.signal.aborted ||
        activeStatsRequestKey !== requestKey
      ) {
        return;
      }

      const message = error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE;
      statsResponse = null;
      statsLoadStatus = 'error';
      loadedStatsRequestKey = null;
      statsErrorMessage = message;
      if (showToast) toastStore.error(message);
    } finally {
      if (activeStatsRequestKey === requestKey) {
        activeStatsRequestKey = null;
      }

      if (activeStatsAbortController === abortController) {
        activeStatsAbortController = null;
      }
    }
  }

  async function loadHistory(
    query: GameSessionHistoryQuery,
    append: boolean,
    showToast: boolean
  ): Promise<void> {
    if (!authStore.accessToken) return;

    activeAbortController?.abort();
    const abortController = new AbortController();
    activeAbortController = abortController;
    const requestId = requestSequence + 1;
    requestSequence = requestId;

    if (append) {
      isLoadingMore = true;
    } else {
      isInitialLoading = true;
      sessions = [];
      nextCursor = null;
    }
    errorMessage = null;

    try {
      const response = await getGameSessions({
        accessToken: authStore.accessToken,
        limit: query.limit,
        cursor: query.cursor,
        mode: query.mode,
        signal: abortController.signal
      });
      if (requestId !== requestSequence) return;

      sessions = append ? [...sessions, ...response.sessions] : [...response.sessions];
      nextCursor = response.nextCursor;
    } catch (error) {
      if (isAbortError(error) || requestId !== requestSequence) return;

      const message = error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE;
      errorMessage = message;
      if (showToast) toastStore.error(message);
    } finally {
      if (requestId === requestSequence) {
        isInitialLoading = false;
        isLoadingMore = false;
        if (activeAbortController === abortController) activeAbortController = null;
      }
    }
  }

  function toHistorySearchParams(query: GameSessionHistoryQuery): URLSearchParams {
    const searchParams = new URLSearchParams();
    if (query.limit !== DEFAULT_GAME_SESSION_HISTORY_LIMIT)
      searchParams.set('limit', String(query.limit));
    if (query.cursor) searchParams.set('cursor', query.cursor);
    if (query.mode) searchParams.set('mode', query.mode);
    return searchParams;
  }

  async function updateQuery(query: GameSessionHistoryQuery): Promise<void> {
    const queryString = toHistorySearchParams(query).toString();
    await goto(queryString.length > 0 ? page.url.pathname + '?' + queryString : page.url.pathname, {
      keepFocus: true,
      noScroll: true
    });
  }

  function handleModeChange(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    const mode = target.value.length > 0 ? (target.value as GameMode) : null;
    void updateQuery({ limit: appliedQuery.limit, cursor: null, mode });
  }

  function retryStats(): void {
    if (!authStore.accessToken || isStatsLoading) return;
    void loadStats(authStore.accessToken, true, true);
  }

  function retryHistory(): void {
    void loadHistory(appliedQuery, false, true);
  }

  function loadMore(): void {
    if (!nextCursor || isLoadingMore) return;
    void loadHistory({ ...appliedQuery, cursor: nextCursor }, true, true);
  }

  function getModeLabel(mode: GameMode): string {
    const config = getGameModeConfig(mode);
    return config.formatLabel + '・' + config.difficultyLabel;
  }
</script>

<div class="space-y-6">
  <section class="space-y-2">
    <p class="text-text-subtle text-sm font-semibold">学習記録</p>
    <h1 class="text-text text-2xl font-bold">マイページ</h1>
    <p class="text-text-muted max-w-2xl text-sm leading-6">
      統計サマリーと保存されたゲーム履歴を確認できます。
    </p>
  </section>

  {#if authStore.isInitializing}
    <section
      class="border-border-muted bg-surface rounded border p-5"
      aria-busy="true"
      aria-live="polite"
    >
      <p class="text-text-muted text-sm">ログイン状態を確認しています...</p>
    </section>
  {:else if !authStore.isLoggedIn}
    <section class="border-border-muted bg-surface rounded border p-5">
      <h2 class="text-text text-lg font-bold">ログインが必要です</h2>
      <p class="text-text-muted mt-2 text-sm">
        統計情報とゲーム履歴を見るにはログインしてください。
      </p>
      <a
        class="bg-action text-text-inverse hover:bg-action-hover focus-visible:outline-focus mt-4 inline-flex rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        href={'/login'}
      >
        ログインへ
      </a>
    </section>
  {:else}
    <section class="space-y-4" aria-labelledby="stats-heading" aria-busy={isStatsLoading}>
      <div>
        <h2 id="stats-heading" class="text-text text-lg font-bold">統計サマリー</h2>
        <p class="text-text-muted mt-1 text-sm">累計成績と直近10ゲームの正答率推移です。</p>
      </div>

      {#if statsLoadStatus === 'loading'}
        <div class="border-border-muted bg-surface rounded border p-5" aria-live="polite">
          <p class="text-text-muted text-sm">統計情報を読み込んでいます...</p>
        </div>
      {:else if statsLoadStatus === 'error'}
        <div
          class="border-danger-border bg-danger-surface text-danger-text rounded border p-5"
          role="alert"
        >
          <p class="text-sm font-semibold">{statsErrorMessage}</p>
          <button
            type="button"
            onclick={retryStats}
            disabled={isStatsLoading}
            class="border-danger-border-strong bg-surface text-danger-text hover:bg-danger-surface-strong focus-visible:outline-danger-border-strong disabled:bg-danger-surface-strong mt-3 rounded border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
          >
            再試行
          </button>
        </div>
      {:else if statsResponse}
        <StatsSummaryCards stats={statsResponse.stats} />
        <AccuracyTrendChart items={statsResponse.recentAccuracyTrend} />
      {/if}
    </section>

    <section
      class="space-y-4"
      aria-labelledby="game-history-heading"
      aria-busy={isInitialLoading || isLoadingMore}
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="game-history-heading" class="text-text text-lg font-bold">ゲーム履歴</h2>
          <p class="text-text-muted mt-1 text-sm">新しいプレイから順に表示します。</p>
        </div>
        <label class="text-text flex flex-col gap-1 text-sm font-semibold">
          モード
          <select
            value={selectedModeValue}
            onchange={handleModeChange}
            class="border-border bg-surface text-text focus:border-focus focus:ring-info-border rounded border px-3 py-2 text-sm font-normal focus:ring-2 focus:outline-none"
          >
            <option value="">すべて</option>
            {#each GAME_MODE_CONFIGS as config (config.mode)}
              <option value={config.mode}>{config.formatLabel}・{config.difficultyLabel}</option>
            {/each}
          </select>
        </label>
      </div>

      {#if isInitialLoading}
        <div class="border-border-muted bg-surface rounded border p-5" aria-live="polite">
          <p class="text-text-muted text-sm">ゲーム履歴を読み込んでいます...</p>
        </div>
      {:else if errorMessage && !hasSessions}
        <div
          class="border-danger-border bg-danger-surface text-danger-text rounded border p-5"
          role="alert"
        >
          <p class="text-sm font-semibold">{errorMessage}</p>
          <button
            type="button"
            onclick={retryHistory}
            class="border-danger-border-strong bg-surface text-danger-text hover:bg-danger-surface-strong focus-visible:outline-danger-border-strong mt-3 rounded border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            再試行
          </button>
        </div>
      {:else if !hasSessions}
        <div class="border-border-muted bg-surface rounded border p-5">
          <p class="text-text-muted text-sm">まだゲーム履歴がありません。</p>
          <a
            class="bg-action text-text-inverse hover:bg-action-hover focus-visible:outline-focus mt-4 inline-flex rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
            href={'/game'}
          >
            ゲームを始める
          </a>
        </div>
      {:else}
        <div class="space-y-3" aria-live="polite">
          {#if errorMessage}
            <div
              class="border-danger-border bg-danger-surface text-danger-text rounded border p-3 text-sm"
              role="alert"
            >
              {errorMessage}
            </div>
          {/if}
          <ul class="grid gap-3" role="list">
            {#each sessions as session (session.sessionId)}
              <li class="border-border-muted bg-surface rounded border p-4">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div class="min-w-0 space-y-1">
                    <p class="text-action text-sm font-semibold">{getModeLabel(session.mode)}</p>
                    <p class="text-text text-lg font-bold">{session.totalScore}点</p>
                    <p class="text-text-muted text-sm">
                      {session.correctCount}/{session.totalCount}問正解・正答率{getGameSessionAccuracy(
                        session
                      )}%・最大{session.maxStreak}連続正解
                    </p>
                    <p class="text-text-subtle text-sm">
                      {formatGameSessionPlayedAt(session.playedAt)} / {session.durationSec}秒
                    </p>
                  </div>
                  <a
                    class="border-border text-text hover:bg-surface-muted focus-visible:outline-focus inline-flex shrink-0 items-center justify-center rounded border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
                    href={'/game/result?sessionId=' + encodeURIComponent(session.sessionId)}
                  >
                    詳細を見る
                  </a>
                </div>
              </li>
            {/each}
          </ul>
          {#if nextCursor}
            <button
              type="button"
              onclick={loadMore}
              disabled={isLoadingMore}
              class="bg-action text-text-inverse hover:bg-action-hover focus-visible:outline-focus disabled:bg-disabled-solid rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
            >
              {#if isLoadingMore}
                読み込み中...
              {:else}
                さらに表示
              {/if}
            </button>
          {/if}
        </div>
      {/if}
    </section>
  {/if}
</div>
