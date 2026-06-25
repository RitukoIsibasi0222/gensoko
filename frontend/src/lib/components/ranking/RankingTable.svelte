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

<div class="overflow-hidden rounded border border-gray-200 bg-white shadow-sm">
  <div class="overflow-x-auto">
    <table class="min-w-full divide-y divide-gray-200 text-sm">
      <caption class="sr-only">{caption}</caption>
      <thead
        class="bg-gray-50 text-left text-xs font-semibold tracking-normal text-gray-600 uppercase"
      >
        <tr>
          <th scope="col" class="w-20 px-4 py-3">順位</th>
          <th scope="col" class="min-w-40 px-4 py-3">ユーザー</th>
          <th scope="col" class="min-w-32 px-4 py-3 text-right">スコア</th>
          <th scope="col" class="min-w-28 px-4 py-3 text-right">ゲーム数</th>
          <th scope="col" class="min-w-28 px-4 py-3 text-right">正答率</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100 bg-white">
        {#each entries as entry (entry.rank + '-' + entry.username)}
          <tr class="text-gray-700">
            <td class="px-4 py-3 font-bold text-gray-900">{entry.rank}位</td>
            <th scope="row" class="px-4 py-3 font-semibold text-gray-900">{entry.username}</th>
            <td class="px-4 py-3 text-right font-semibold text-blue-700">
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
