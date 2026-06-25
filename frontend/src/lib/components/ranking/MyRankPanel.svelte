<script lang="ts">
  import type { RankingPeriod } from '$lib/api/ranking';

  type Props = {
    myRank: number | null;
    isLoggedIn: boolean;
    period: RankingPeriod;
  };

  let { myRank, isLoggedIn, period }: Props = $props();

  const periodLabel = $derived(period === 'weekly' ? '週間' : '全期間');
</script>

<aside
  class="rounded border border-blue-100 bg-blue-50 p-4 text-blue-950"
  aria-labelledby="my-rank-heading"
>
  <h2 id="my-rank-heading" class="text-sm font-bold">自分の順位</h2>

  {#if !isLoggedIn}
    <p class="mt-2 text-sm leading-6 text-blue-900">
      ログインすると、{periodLabel}ランキングでの自分の順位を確認できます。
    </p>
    <a
      href="/login"
      class="mt-3 inline-flex rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
    >
      ログインへ
    </a>
  {:else if myRank === null}
    <p class="mt-2 text-sm leading-6 text-blue-900">
      まだランキング対象のプレイ記録がありません。ゲームを保存すると順位に反映されます。
    </p>
    <a
      href="/game"
      class="mt-3 inline-flex rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
    >
      ゲームを始める
    </a>
  {:else}
    <p class="mt-2 text-3xl font-bold">{myRank}位</p>
    <p class="mt-1 text-sm text-blue-900">{periodLabel}ランキングでの現在の順位です。</p>
  {/if}
</aside>
