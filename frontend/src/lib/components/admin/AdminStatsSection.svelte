<script lang="ts">
  import type { AdminStats } from '$lib/api/admin';

  type Props = {
    stats: AdminStats | null;
    isLoading?: boolean;
    errorMessage?: string | null;
    onRetry?: () => void;
  };

  let { stats, isLoading = false, errorMessage = null, onRetry }: Props = $props();

  function formatNumber(value: number): string {
    return value.toLocaleString('ja-JP');
  }
</script>

<section
  aria-labelledby="admin-stats-heading"
  aria-busy={isLoading}
  class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <p class="text-brand text-sm font-semibold">Overview</p>
      <h2 id="admin-stats-heading" class="text-ink mt-1 text-xl font-bold">サービス統計</h2>
    </div>
    {#if isLoading}
      <p aria-live="polite" class="text-sm text-gray-600">サービス統計を読み込んでいます...</p>
    {/if}
  </div>

  {#if errorMessage !== null}
    <div class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
      <p class="text-sm text-red-700">
        {errorMessage || '統計情報を表示できませんでした'}
      </p>
      {#if onRetry}
        <button
          type="button"
          class="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
          onclick={onRetry}
          disabled={isLoading}
        >
          統計を再読み込み
        </button>
      {/if}
    </div>
  {/if}

  {#if stats}
    <div class="mt-5 grid gap-4 lg:grid-cols-3">
      <article class="rounded-xl bg-blue-50 p-4">
        <h3 class="font-semibold text-blue-950">ユーザー</h3>
        <dl class="mt-3 grid gap-3 text-sm">
          <div class="flex items-start justify-between gap-3">
            <dt class="text-gray-700">登録ユーザー累計（退会含む）</dt>
            <dd class="font-bold text-blue-950">{formatNumber(stats.users.total)}</dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-gray-700">有効アカウント（未退会）</dt>
            <dd class="font-bold text-blue-950">{formatNumber(stats.users.active)}</dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-gray-700">停止中（未退会）</dt>
            <dd class="font-bold text-blue-950">{formatNumber(stats.users.suspended)}</dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-gray-700">退会済み</dt>
            <dd class="font-bold text-blue-950">{formatNumber(stats.users.deleted)}</dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-gray-700">未退会ADMIN</dt>
            <dd class="font-bold text-blue-950">{formatNumber(stats.users.admins)}</dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-gray-700">メール確認済み（未退会）</dt>
            <dd class="font-bold text-blue-950">{formatNumber(stats.users.emailVerified)}</dd>
          </div>
        </dl>
      </article>

      <article class="rounded-xl bg-amber-50 p-4">
        <h3 class="font-semibold text-amber-950">ゲーム</h3>
        <dl class="mt-3 grid gap-3 text-sm">
          <div class="flex items-start justify-between gap-3">
            <dt class="text-gray-700">総ゲーム回数</dt>
            <dd class="font-bold text-amber-950">{formatNumber(stats.games.totalSessions)}</dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-gray-700">総回答数</dt>
            <dd class="font-bold text-amber-950">{formatNumber(stats.games.totalAnswered)}</dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-gray-700">平均正答率</dt>
            <dd class="font-bold text-amber-950">{stats.games.averageAccuracyRate}%</dd>
          </div>
        </dl>
      </article>

      <article class="rounded-xl bg-emerald-50 p-4">
        <h3 class="font-semibold text-emerald-950">学習</h3>
        <dl class="mt-3 grid gap-3 text-sm">
          <div class="flex items-start justify-between gap-3">
            <dt class="text-gray-700">苦手元素登録数</dt>
            <dd class="font-bold text-emerald-950">
              {formatNumber(stats.learning.totalWeakElements)}
            </dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-gray-700">習得元素数の累計</dt>
            <dd class="font-bold text-emerald-950">
              {formatNumber(stats.learning.totalMasteredCount)}
            </dd>
          </div>
        </dl>
      </article>
    </div>
  {:else if !isLoading && errorMessage === null}
    <p class="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
      統計情報はまだ読み込まれていません
    </p>
  {/if}
</section>
