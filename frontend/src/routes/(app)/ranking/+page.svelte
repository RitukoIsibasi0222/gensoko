<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy } from 'svelte';
  import { ApiError } from '$lib/api/errors';
  import { getRanking, type RankingPeriod, type RankingResponse } from '$lib/api/ranking';
  import MyRankPanel from '$lib/components/ranking/MyRankPanel.svelte';
  import RankingTable from '$lib/components/ranking/RankingTable.svelte';
  import {
    isRankingPeriodActivationKey,
    normalizeRankingPeriod,
    toRankingSearchParams
  } from '$lib/ranking/ranking';
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';

  const NETWORK_ERROR_MESSAGE = 'ネットワークエラーが発生しました。接続を確認してください';

  type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

  let rankingResponse = $state<RankingResponse | null>(null);
  let loadStatus = $state<LoadStatus>('idle');
  let errorMessage = $state<string | null>(null);
  let activeAbortController: AbortController | null = null;
  let activeRequestKey: string | null = null;
  let loadedRequestKey: string | null = null;

  const currentPeriod = $derived(normalizeRankingPeriod(page.url.searchParams.get('period')));
  const isLoading = $derived(loadStatus === 'loading');
  const isRankingBusy = $derived(authStore.isInitializing || isLoading);
  const hasRankingEntries = $derived((rankingResponse?.ranking.length ?? 0) > 0);

  $effect(() => {
    if (authStore.isInitializing) return;

    const accessToken = authStore.isLoggedIn ? authStore.accessToken : null;
    void loadRanking(currentPeriod, accessToken, false, false);
  });

  onDestroy(() => {
    activeAbortController?.abort();
  });

  function getRequestKey(period: RankingPeriod, accessToken: string | null | undefined): string {
    return period + ':' + (accessToken ?? '');
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  async function loadRanking(
    period: RankingPeriod,
    accessToken: string | null | undefined,
    force: boolean,
    showToast: boolean
  ): Promise<void> {
    const requestKey = getRequestKey(period, accessToken);
    if (!force && (activeRequestKey === requestKey || loadedRequestKey === requestKey)) {
      return;
    }

    activeAbortController?.abort();
    const abortController = new AbortController();
    activeAbortController = abortController;
    activeRequestKey = requestKey;

    if (force) {
      loadedRequestKey = null;
    }

    loadStatus = 'loading';
    errorMessage = null;

    try {
      const response = await getRanking({
        period,
        accessToken,
        signal: abortController.signal
      });

      if (abortController.signal.aborted || activeRequestKey !== requestKey) {
        return;
      }

      rankingResponse = response;
      loadStatus = 'success';
      loadedRequestKey = requestKey;
    } catch (error) {
      if (
        isAbortError(error) ||
        abortController.signal.aborted ||
        activeRequestKey !== requestKey
      ) {
        return;
      }

      const message = error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE;
      rankingResponse = null;
      loadStatus = 'error';
      loadedRequestKey = null;
      errorMessage = message;
      if (showToast) toastStore.error(message);
    } finally {
      if (activeRequestKey === requestKey) {
        activeRequestKey = null;
      }

      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
    }
  }

  async function updatePeriod(period: RankingPeriod): Promise<void> {
    if (period === currentPeriod) return;

    const queryString = toRankingSearchParams(period).toString();
    await goto(page.url.pathname + '?' + queryString, {
      keepFocus: true,
      noScroll: true
    });
  }

  function handlePeriodKeydown(event: KeyboardEvent, period: RankingPeriod): void {
    if (event.repeat || !isRankingPeriodActivationKey(event.key)) return;

    event.preventDefault();
    void updatePeriod(period);
  }

  function retryRanking(): void {
    if (isLoading || authStore.isInitializing) return;
    const accessToken = authStore.isLoggedIn ? authStore.accessToken : null;
    void loadRanking(currentPeriod, accessToken, true, true);
  }
</script>

<div class="space-y-6">
  <section class="space-y-2">
    <p class="text-text-subtle text-sm font-semibold">ランキング</p>
    <h1 class="text-text text-2xl font-bold">週間・全期間ランキング</h1>
    <p class="text-text-muted max-w-2xl text-sm leading-6">
      保存されたゲーム結果のスコアをもとに、上位50件を表示します。
    </p>
  </section>

  <section
    class="space-y-4"
    aria-labelledby="ranking-heading"
    aria-busy={isRankingBusy ? 'true' : undefined}
  >
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 id="ranking-heading" class="text-text text-lg font-bold">
          {currentPeriod === 'weekly' ? '週間ランキング' : '全期間ランキング'}
        </h2>
        <p class="text-text-muted mt-1 text-sm">
          {currentPeriod === 'weekly'
            ? '今週のスコア順に表示します。'
            : 'これまでの累計スコア順に表示します。'}
        </p>
      </div>

      <div
        class="border-border bg-surface inline-flex rounded border p-1"
        role="group"
        aria-label="ランキング種別"
      >
        <button
          type="button"
          class={currentPeriod === 'weekly'
            ? 'bg-action text-text-inverse rounded px-4 py-2 text-sm font-semibold'
            : 'text-text hover:bg-surface-muted focus-visible:outline-focus rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2'}
          aria-pressed={currentPeriod === 'weekly'}
          onclick={() => updatePeriod('weekly')}
          onkeydown={(event) => handlePeriodKeydown(event, 'weekly')}
        >
          週間
        </button>
        <button
          type="button"
          class={currentPeriod === 'alltime'
            ? 'bg-action text-text-inverse rounded px-4 py-2 text-sm font-semibold'
            : 'text-text hover:bg-surface-muted focus-visible:outline-focus rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2'}
          aria-pressed={currentPeriod === 'alltime'}
          onclick={() => updatePeriod('alltime')}
          onkeydown={(event) => handlePeriodKeydown(event, 'alltime')}
        >
          全期間
        </button>
      </div>
    </div>

    {#if isRankingBusy}
      <div class="border-border-muted bg-surface rounded border p-5" aria-live="polite">
        <p class="text-text-muted text-sm">ランキングを読み込んでいます...</p>
      </div>
    {:else if loadStatus === 'error'}
      <div
        class="border-danger-border bg-danger-surface text-danger-text rounded border p-5"
        role="alert"
      >
        <p class="text-sm font-semibold">{errorMessage}</p>
        <button
          type="button"
          onclick={retryRanking}
          disabled={isLoading}
          class="border-danger-border-strong bg-surface text-danger-text hover:bg-danger-surface-strong focus-visible:outline-danger-border-strong disabled:bg-danger-surface-strong mt-3 rounded border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
        >
          再試行
        </button>
      </div>
    {:else if rankingResponse && !hasRankingEntries}
      <div class="border-border-muted bg-surface rounded border p-5">
        <p class="text-text-muted text-sm">まだランキング対象のゲーム結果がありません。</p>
        <a
          class="bg-action text-text-inverse hover:bg-action-hover focus-visible:outline-focus mt-4 inline-flex rounded px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
          href="/game"
        >
          ゲームを始める
        </a>
      </div>
    {:else if rankingResponse}
      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <RankingTable entries={rankingResponse.ranking} period={rankingResponse.period} />
        <MyRankPanel
          myRank={rankingResponse.myRank}
          isLoggedIn={!authStore.isInitializing && authStore.isLoggedIn}
          period={rankingResponse.period}
        />
      </div>
    {/if}
  </section>
</div>
