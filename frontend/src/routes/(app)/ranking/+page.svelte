<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy } from 'svelte';
  import { ApiError } from '$lib/api/errors';
  import { getRanking, type RankingPeriod, type RankingResponse } from '$lib/api/ranking';
  import MyRankPanel from '$lib/components/ranking/MyRankPanel.svelte';
  import RankingTable from '$lib/components/ranking/RankingTable.svelte';
  import { normalizeRankingPeriod, toRankingSearchParams } from '$lib/ranking/ranking';
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

  function retryRanking(): void {
    if (isLoading || authStore.isInitializing) return;
    const accessToken = authStore.isLoggedIn ? authStore.accessToken : null;
    void loadRanking(currentPeriod, accessToken, true, true);
  }
</script>

<div class="space-y-6">
  <section class="space-y-2">
    <p class="text-sm font-semibold text-gray-500">ランキング</p>
    <h1 class="text-2xl font-bold text-gray-900">週間・全期間ランキング</h1>
    <p class="max-w-2xl text-sm leading-6 text-gray-600">
      保存されたゲーム結果のスコアをもとに、上位50件を表示します。
    </p>
  </section>

  <section class="space-y-4" aria-labelledby="ranking-heading" aria-busy={isLoading}>
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 id="ranking-heading" class="text-lg font-bold text-gray-900">
          {currentPeriod === 'weekly' ? '週間ランキング' : '全期間ランキング'}
        </h2>
        <p class="mt-1 text-sm text-gray-600">
          {currentPeriod === 'weekly'
            ? '今週のスコア順に表示します。'
            : 'これまでの累計スコア順に表示します。'}
        </p>
      </div>

      <div
        class="inline-flex rounded border border-gray-300 bg-white p-1"
        role="group"
        aria-label="ランキング種別"
      >
        <button
          type="button"
          class={currentPeriod === 'weekly'
            ? 'rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white'
            : 'rounded px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'}
          aria-current={currentPeriod === 'weekly' ? 'page' : undefined}
          onclick={() => updatePeriod('weekly')}
        >
          週間
        </button>
        <button
          type="button"
          class={currentPeriod === 'alltime'
            ? 'rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white'
            : 'rounded px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500'}
          aria-current={currentPeriod === 'alltime' ? 'page' : undefined}
          onclick={() => updatePeriod('alltime')}
        >
          全期間
        </button>
      </div>
    </div>

    {#if authStore.isInitializing || loadStatus === 'loading'}
      <div class="rounded border border-gray-200 bg-white p-5" aria-live="polite">
        <p class="text-sm text-gray-600">ランキングを読み込んでいます...</p>
      </div>
    {:else if loadStatus === 'error'}
      <div class="rounded border border-red-200 bg-red-50 p-5 text-red-700" role="alert">
        <p class="text-sm font-semibold">{errorMessage}</p>
        <button
          type="button"
          onclick={retryRanking}
          disabled={isLoading}
          class="mt-3 rounded border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:bg-red-100"
        >
          再試行
        </button>
      </div>
    {:else if rankingResponse && !hasRankingEntries}
      <div class="rounded border border-gray-200 bg-white p-5">
        <p class="text-sm text-gray-600">まだランキング対象のゲーム結果がありません。</p>
        <a
          class="mt-4 inline-flex rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
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
