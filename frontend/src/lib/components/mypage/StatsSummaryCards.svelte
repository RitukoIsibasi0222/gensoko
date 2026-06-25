<script lang="ts">
  import type { MyStatsSummary } from '$lib/api/users';
  import { formatAccuracyRate, formatStatNumber, formatStatsDate } from '$lib/mypage/stats';

  type Props = {
    stats: MyStatsSummary;
  };

  let { stats }: Props = $props();

  const summaryItems = $derived([
    {
      label: '総ゲーム数',
      value: formatStatNumber(stats.totalGames),
      description: 'これまでに保存されたプレイ回数'
    },
    {
      label: '総正解数',
      value: formatStatNumber(stats.totalCorrect),
      description: formatStatNumber(stats.totalAnswered) + '問中の正解数'
    },
    {
      label: '平均正答率',
      value: formatAccuracyRate(stats.averageAccuracyRate),
      description: '累計回答に対する正答率'
    },
    {
      label: '習得済み元素',
      value: formatStatNumber(stats.masteredCount),
      description: '直近2回連続正解した元素'
    },
    {
      label: '連続ログイン',
      value: formatStatNumber(stats.currentStreak) + '日',
      description: '現在のログイン継続日数'
    },
    {
      label: '全期間スコア',
      value: formatStatNumber(stats.allTimeScore),
      description: '週間 ' + formatStatNumber(stats.weeklyScore) + ' pt'
    }
  ]);
</script>

<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
  {#each summaryItems as item (item.label)}
    <article class="rounded border border-gray-200 bg-white p-4 shadow-sm">
      <p class="text-sm font-semibold text-gray-500">{item.label}</p>
      <p class="mt-2 text-2xl font-bold text-gray-900">{item.value}</p>
      <p class="mt-1 text-sm text-gray-600">{item.description}</p>
    </article>
  {/each}
</div>

<p class="text-xs text-gray-500">最終更新: {formatStatsDate(stats.updatedAt)}</p>
