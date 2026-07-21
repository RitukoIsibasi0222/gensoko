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
  class="border-info-border bg-info-surface text-info-text-strong rounded border p-4"
  aria-labelledby="my-rank-heading"
>
  <h2 id="my-rank-heading" class="text-sm font-bold">自分の順位</h2>

  {#if !isLoggedIn}
    <p class="text-info-text mt-2 text-sm leading-6">
      ログインすると、{periodLabel}ランキングでの自分の順位を確認できます。
    </p>
    <a
      href="/login"
      class="bg-action text-text-inverse hover:bg-action-hover focus-visible:outline-focus mt-3 inline-flex rounded px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      ログインへ
    </a>
  {:else if myRank === null}
    <p class="text-info-text mt-2 text-sm leading-6">
      まだランキング対象のプレイ記録がありません。ゲームを保存すると順位に反映されます。
    </p>
    <a
      href="/game"
      class="bg-action text-text-inverse hover:bg-action-hover focus-visible:outline-focus mt-3 inline-flex rounded px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      ゲームを始める
    </a>
  {:else}
    <p class="mt-2 text-3xl font-bold">{myRank}位</p>
    <p class="text-info-text mt-1 text-sm">{periodLabel}ランキングでの現在の順位です。</p>
  {/if}
</aside>
