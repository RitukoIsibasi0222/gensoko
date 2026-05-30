<script lang="ts">
  import type { HomeRankingPreviewEntry } from '$lib/home/content';

  type Props = {
    entries: readonly HomeRankingPreviewEntry[];
    moreHref?: string;
    emptyMessage?: string;
  };

  let {
    entries,
    moreHref = '/ranking',
    emptyMessage = 'ランキングは準備中です。'
  }: Props = $props();

  const scoreFormatter = new Intl.NumberFormat('ja-JP');
</script>

<section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
  <div class="flex items-center justify-between gap-4">
    <h2 class="text-ink text-2xl font-bold">ランキングプレビュー</h2>
    <a
      href={moreHref}
      class="text-brand focus-visible:outline-brand text-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      もっと見る
    </a>
  </div>

  {#if entries.length === 0}
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
          <p class="text-brand text-sm font-bold">{scoreFormatter.format(entry.weeklyScore)} pt</p>
        </li>
      {/each}
    </ol>
  {/if}
</section>
