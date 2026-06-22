<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy } from 'svelte';
  import { ApiError } from '$lib/api/errors';
  import { getGameSessions } from '$lib/api/game';
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

  $effect(() => {
    if (authStore.isInitializing) return;

    if (!authStore.isLoggedIn || !authStore.accessToken) {
      resetHistoryState();
      isInitialLoading = false;
      return;
    }

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

  onDestroy(() => activeAbortController?.abort());

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
    <p class="text-sm font-semibold text-gray-500">学習記録</p>
    <h1 class="text-2xl font-bold text-gray-900">マイページ</h1>
    <p class="max-w-2xl text-sm leading-6 text-gray-600">保存されたゲーム履歴を確認できます。</p>
  </section>

  {#if authStore.isInitializing}
    <section
      class="rounded border border-gray-200 bg-white p-5"
      aria-busy="true"
      aria-live="polite"
    >
      <p class="text-sm text-gray-600">ログイン状態を確認しています...</p>
    </section>
  {:else if !authStore.isLoggedIn}
    <section class="rounded border border-gray-200 bg-white p-5">
      <h2 class="text-lg font-bold text-gray-900">ログインが必要です</h2>
      <p class="mt-2 text-sm text-gray-600">ゲーム履歴を見るにはログインしてください。</p>
      <a
        class="mt-4 inline-flex rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        href={'/login'}
      >
        ログインへ
      </a>
    </section>
  {:else}
    <section
      class="space-y-4"
      aria-labelledby="game-history-heading"
      aria-busy={isInitialLoading || isLoadingMore}
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="game-history-heading" class="text-lg font-bold text-gray-900">ゲーム履歴</h2>
          <p class="mt-1 text-sm text-gray-600">新しいプレイから順に表示します。</p>
        </div>
        <label class="flex flex-col gap-1 text-sm font-semibold text-gray-700">
          モード
          <select
            value={selectedModeValue}
            onchange={handleModeChange}
            class="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
          >
            <option value="">すべて</option>
            {#each GAME_MODE_CONFIGS as config (config.mode)}
              <option value={config.mode}>{config.formatLabel}・{config.difficultyLabel}</option>
            {/each}
          </select>
        </label>
      </div>

      {#if isInitialLoading}
        <div class="rounded border border-gray-200 bg-white p-5" aria-live="polite">
          <p class="text-sm text-gray-600">ゲーム履歴を読み込んでいます...</p>
        </div>
      {:else if errorMessage && !hasSessions}
        <div class="rounded border border-red-200 bg-red-50 p-5 text-red-700" role="alert">
          <p class="text-sm font-semibold">{errorMessage}</p>
          <button
            type="button"
            onclick={retryHistory}
            class="mt-3 rounded border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
          >
            再試行
          </button>
        </div>
      {:else if !hasSessions}
        <div class="rounded border border-gray-200 bg-white p-5">
          <p class="text-sm text-gray-600">まだゲーム履歴がありません。</p>
          <a
            class="mt-4 inline-flex rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            href={'/game'}
          >
            ゲームを始める
          </a>
        </div>
      {:else}
        <div class="space-y-3" aria-live="polite">
          {#if errorMessage}
            <div
              class="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              role="alert"
            >
              {errorMessage}
            </div>
          {/if}
          <ul class="grid gap-3" role="list">
            {#each sessions as session (session.sessionId)}
              <li class="rounded border border-gray-200 bg-white p-4">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div class="min-w-0 space-y-1">
                    <p class="text-sm font-semibold text-blue-700">{getModeLabel(session.mode)}</p>
                    <p class="text-lg font-bold text-gray-900">{session.totalScore}点</p>
                    <p class="text-sm text-gray-600">
                      {session.correctCount}/{session.totalCount}問正解・正答率{getGameSessionAccuracy(
                        session
                      )}%・最大{session.maxStreak}連続正解
                    </p>
                    <p class="text-sm text-gray-500">
                      {formatGameSessionPlayedAt(session.playedAt)} / {session.durationSec}秒
                    </p>
                  </div>
                  <a
                    class="inline-flex shrink-0 items-center justify-center rounded border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
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
              class="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:bg-gray-400"
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
