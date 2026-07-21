<script lang="ts">
  import type { HomeRankingPreviewEntry } from '$lib/home/content';
  import { formatRankingScore } from '$lib/ranking/ranking';

  const ERROR_FALLBACK_MESSAGE = 'ランキングを表示できませんでした。';

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

  const displayErrorMessage = $derived(
    errorMessage !== null && errorMessage.trim() !== '' ? errorMessage : ERROR_FALLBACK_MESSAGE
  );
</script>

<section
  class="border-border-muted bg-surface rounded-2xl border p-6 shadow-sm sm:p-8"
  aria-labelledby="home-ranking-preview-heading"
  aria-busy={isLoading ? 'true' : undefined}
>
  <div class="flex items-center justify-between gap-4">
    <h2 id="home-ranking-preview-heading" class="text-text text-2xl font-bold">
      ランキングプレビュー
    </h2>
    <a
      href={moreHref}
      aria-label={moreAriaLabel}
      class="text-brand focus-visible:outline-focus text-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      もっと見る
    </a>
  </div>

  {#if isLoading}
    <p
      class="border-border-muted bg-surface-muted text-text-muted mt-4 rounded-lg border p-4 text-sm"
      aria-live="polite"
    >
      ランキングを読み込んでいます...
    </p>
  {:else if errorMessage !== null}
    <div
      class="border-danger-border bg-danger-surface text-danger-text mt-4 rounded-lg border p-4 text-sm"
      role="alert"
    >
      <p class="font-semibold">{displayErrorMessage}</p>
      {#if onRetry}
        <button
          type="button"
          onclick={onRetry}
          disabled={isLoading}
          class="border-danger-border-strong bg-surface text-danger-text hover:bg-danger-surface-strong focus-visible:outline-danger-border-strong disabled:bg-danger-surface-strong mt-3 rounded border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
        >
          再試行
        </button>
      {/if}
    </div>
  {:else if entries.length === 0}
    <p
      class="border-border bg-surface-muted text-text-muted mt-4 rounded-lg border border-dashed p-4 text-sm"
    >
      {emptyMessage}
    </p>
  {:else}
    <ol class="mt-4 space-y-3" aria-label="週間ランキング上位プレビュー">
      {#each entries as entry (entry.rank + '-' + entry.username)}
        <li
          class="border-border-muted flex items-center justify-between rounded-lg border px-4 py-3"
        >
          <div>
            <p class="text-text text-sm font-semibold">{entry.rank}位 {entry.username}</p>
            <p class="text-text-subtle text-xs">{entry.totalGames}ゲーム</p>
          </div>
          <p class="text-brand text-sm font-bold">{formatRankingScore(entry.weeklyScore)}</p>
        </li>
      {/each}
    </ol>
  {/if}
</section>
