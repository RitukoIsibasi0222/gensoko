<script lang="ts">
  import type { RankingEntry, RankingPeriod } from '$lib/api/ranking';
  import { formatRankingAccuracy, formatRankingScore } from '$lib/ranking/ranking';

  type Props = {
    entries: readonly RankingEntry[];
    period: RankingPeriod;
  };

  let { entries, period }: Props = $props();

  const caption = $derived(period === 'weekly' ? '週間ランキング' : '全期間ランキング');
</script>

<div class="border-border-muted bg-surface overflow-hidden rounded border">
  <div class="overflow-x-auto">
    <table class="divide-border min-w-full divide-y text-sm">
      <caption class="sr-only">{caption}</caption>
      <thead
        class="bg-surface-muted text-text-muted text-left text-xs font-semibold tracking-normal uppercase"
      >
        <tr>
          <th scope="col" class="w-20 px-4 py-3">順位</th>
          <th scope="col" class="min-w-40 px-4 py-3">ユーザー</th>
          <th scope="col" class="min-w-32 px-4 py-3 text-right">スコア</th>
          <th scope="col" class="min-w-28 px-4 py-3 text-right">ゲーム数</th>
          <th scope="col" class="min-w-28 px-4 py-3 text-right">正答率</th>
        </tr>
      </thead>
      <tbody class="divide-border-muted bg-surface divide-y">
        {#each entries as entry (entry.rank + '-' + entry.username)}
          <tr class="text-text">
            <td class="text-text px-4 py-3 font-bold">{entry.rank}位</td>
            <th scope="row" class="text-text px-4 py-3 font-semibold">{entry.username}</th>
            <td class="text-action px-4 py-3 text-right font-semibold">
              {formatRankingScore(entry.score)}
            </td>
            <td class="px-4 py-3 text-right">{entry.totalGames}回</td>
            <td class="px-4 py-3 text-right">{formatRankingAccuracy(entry.accuracyRate)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
