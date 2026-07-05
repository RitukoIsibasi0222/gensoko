<script lang="ts">
  import type { HomeRankingPreviewEntry } from '$lib/home/content';
  import { formatRankingScore } from '$lib/ranking/ranking';

  type Props = {
    entries: readonly HomeRankingPreviewEntry[];
    moreHref?: string;
    moreAriaLabel?: string;
    emptyMessage?: string;
    isLoading?: boolean;
    errorMessage?: string | null;
    onRetry?: () => void;
  };

  let {
    entries,
    moreHref = '/ranking',
    moreAriaLabel = 'ランキングをもっと見る',
    emptyMessage = 'ランキングは準備中です。',
    isLoading = false,
    errorMessage = null,
    onRetry
  }: Props = $props();
</script>

<section
  class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
  aria-labelledby="home-ranking-preview-heading"
  aria-busy={isLoading ? 'true' : undefined}
>
  <div class="flex items-center justify-between gap-4">
    <h2 id="home-ranking-preview-heading" class="text-ink text-2xl font-bold">
      ランキングプレビュー
    </h2>
    <a
      href={moreHref}
      aria-label={moreAriaLabel}
      class="text-brand focus-visible:outline-brand text-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      もっと見る
    </a>
  </div>

  {#if isLoading}
    <p
      class="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600"
      aria-live="polite"
    >
      ランキングを読み込んでいます...
    </p>
  {:else if errorMessage}
    <div
      class="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      role="alert"
    >
      <p class="font-semibold">{errorMessage}</p>
      {#if onRetry}
        <button
          type="button"
          onclick={onRetry}
          disabled={isLoading}
          class="mt-3 rounded border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:bg-red-100"
        >
          再試行
        </button>
      {/if}
    </div>
  {:else if entries.length === 0}
    <p
      class="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600"
    >
      {emptyMessage}
    </p>
  {:else}
    <ol class="mt-4 space-y-3" aria-label="週間ランキング上位プレビュー">
      {#each entries as entry (entry.rank + '-' + entry.username)}
        <li class="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
          <div>
            <p class="text-ink text-sm font-semibold">{entry.rank}位 {entry.username}</p>
            <p class="text-xs text-gray-500">{entry.totalGames}ゲーム</p>
          </div>
          <p class="text-brand text-sm font-bold">{formatRankingScore(entry.weeklyScore)}</p>
        </li>
      {/each}
    </ol>
  {/if}
</section>
