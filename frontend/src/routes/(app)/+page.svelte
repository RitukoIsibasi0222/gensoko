<script lang="ts">
  import { onDestroy } from 'svelte';
  import { ApiError } from '$lib/api/errors';
  import { getRanking } from '$lib/api/ranking';
  import AppOverviewSection from '$lib/components/home/AppOverviewSection.svelte';
  import HeroSection from '$lib/components/home/HeroSection.svelte';
  import RankingPreviewSection from '$lib/components/home/RankingPreviewSection.svelte';
  import {
    getPrimaryCta,
    getSecondaryCta,
    getTopPageAudience,
    HOME_HERO_DESCRIPTION,
    HOME_HERO_TITLE,
    HOME_OVERVIEW_ITEMS,
    selectRankingPreviewEntries,
    toHomeRankingPreviewEntries,
    type HomeRankingPreviewEntry
  } from '$lib/home/content';
  import { authStore } from '$lib/stores/auth.svelte';

  const RANKING_PREVIEW_LIMIT = 3;
  const RANKING_PREVIEW_REQUEST_KEY = 'weekly-public';
  const RANKING_PREVIEW_MORE_HREF = '/ranking?period=weekly';
  const RANKING_PREVIEW_MORE_ARIA_LABEL = '週間ランキングをもっと見る';
  const RANKING_PREVIEW_EMPTY_MESSAGE = 'まだランキング対象のゲーム結果がありません。';
  const NETWORK_ERROR_MESSAGE = 'ネットワークエラーが発生しました。接続を確認してください。';

  type LoadStatus = 'loading' | 'success' | 'error';

  let rankingPreviewEntries = $state<HomeRankingPreviewEntry[]>([]);
  let rankingPreviewLoadStatus = $state<LoadStatus>('loading');
  let rankingPreviewErrorMessage = $state<string | null>(null);
  let activeRankingPreviewAbortController: AbortController | null = null;
  let activeRankingPreviewRequestKey: string | null = null;
  let loadedRankingPreviewRequestKey: string | null = null;

  $effect(() => {
    void loadRankingPreview(false);
  });

  onDestroy(() => {
    activeRankingPreviewAbortController?.abort();
  });

  function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  async function loadRankingPreview(force: boolean): Promise<void> {
    const requestKey = RANKING_PREVIEW_REQUEST_KEY;
    if (
      !force &&
      (activeRankingPreviewRequestKey === requestKey ||
        loadedRankingPreviewRequestKey === requestKey)
    ) {
      return;
    }

    activeRankingPreviewAbortController?.abort();
    const abortController = new AbortController();
    activeRankingPreviewAbortController = abortController;
    activeRankingPreviewRequestKey = requestKey;

    if (force) {
      loadedRankingPreviewRequestKey = null;
    }

    rankingPreviewLoadStatus = 'loading';
    rankingPreviewErrorMessage = null;

    try {
      const response = await getRanking({
        period: 'weekly',
        signal: abortController.signal
      });

      if (abortController.signal.aborted || activeRankingPreviewRequestKey !== requestKey) {
        return;
      }

      rankingPreviewEntries = selectRankingPreviewEntries(
        toHomeRankingPreviewEntries(response.ranking),
        RANKING_PREVIEW_LIMIT
      );
      rankingPreviewLoadStatus = 'success';
      loadedRankingPreviewRequestKey = requestKey;
    } catch (error) {
      if (
        isAbortError(error) ||
        abortController.signal.aborted ||
        activeRankingPreviewRequestKey !== requestKey
      ) {
        return;
      }

      rankingPreviewEntries = [];
      rankingPreviewLoadStatus = 'error';
      loadedRankingPreviewRequestKey = null;
      rankingPreviewErrorMessage =
        error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE;
    } finally {
      if (activeRankingPreviewRequestKey === requestKey) {
        activeRankingPreviewRequestKey = null;
      }

      if (activeRankingPreviewAbortController === abortController) {
        activeRankingPreviewAbortController = null;
      }
    }
  }

  function retryRankingPreview(): void {
    if (rankingPreviewLoadStatus === 'loading') return;
    void loadRankingPreview(true);
  }

  // authStore.state.status の初期値が 'initializing' のため SSR/hydration の整合は store 側で担保される。
  // Header.svelte と同じパターンで authStore を直接参照する（mounted フラグは不要）。
  const audience = $derived(getTopPageAudience(authStore.isInitializing, authStore.isLoggedIn));
  const primaryCta = $derived(getPrimaryCta(audience));
  const secondaryCta = $derived(getSecondaryCta(audience));
  const isRankingPreviewLoading = $derived(rankingPreviewLoadStatus === 'loading');
</script>

<div class="space-y-8">
  <HeroSection
    title={HOME_HERO_TITLE}
    description={HOME_HERO_DESCRIPTION}
    {primaryCta}
    {secondaryCta}
  />

  <AppOverviewSection items={HOME_OVERVIEW_ITEMS} />

  <RankingPreviewSection
    entries={rankingPreviewEntries}
    isLoading={isRankingPreviewLoading}
    errorMessage={rankingPreviewErrorMessage}
    onRetry={retryRankingPreview}
    emptyMessage={RANKING_PREVIEW_EMPTY_MESSAGE}
    moreHref={RANKING_PREVIEW_MORE_HREF}
    moreAriaLabel={RANKING_PREVIEW_MORE_ARIA_LABEL}
  />
</div>
