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
  class="border-border-muted bg-surface rounded-2xl border p-5 shadow-sm"
>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <p class="text-brand text-sm font-semibold">Overview</p>
      <h2 id="admin-stats-heading" class="text-text mt-1 text-xl font-bold">サービス統計</h2>
    </div>
    {#if isLoading}
      <p aria-live="polite" class="text-text-muted text-sm">サービス統計を読み込んでいます...</p>
    {/if}
  </div>

  {#if errorMessage !== null}
    <div class="border-danger-border bg-danger-surface mt-4 rounded-xl border p-4" role="alert">
      <p class="text-danger-text text-sm">
        {errorMessage || '統計情報を表示できませんでした'}
      </p>
      {#if onRetry}
        <button
          type="button"
          class="border-danger-border-strong bg-surface text-danger-text hover:bg-danger-surface-strong focus-visible:outline-danger-border-strong mt-3 rounded-lg border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
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
      <article class="bg-info-surface rounded-xl p-4">
        <h3 class="text-info-text-strong font-semibold">ユーザー</h3>
        <dl class="mt-3 grid gap-3 text-sm">
          <div class="flex items-start justify-between gap-3">
            <dt class="text-text">現在の登録ユーザー</dt>
            <dd class="text-info-text-strong font-bold">{formatNumber(stats.users.total)}</dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-text">有効アカウント</dt>
            <dd class="text-info-text-strong font-bold">{formatNumber(stats.users.active)}</dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-text">停止中</dt>
            <dd class="text-info-text-strong font-bold">{formatNumber(stats.users.suspended)}</dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-text">ADMIN</dt>
            <dd class="text-info-text-strong font-bold">{formatNumber(stats.users.admins)}</dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-text">メール確認済み</dt>
            <dd class="text-info-text-strong font-bold">
              {formatNumber(stats.users.emailVerified)}
            </dd>
          </div>
        </dl>
      </article>

      <article class="bg-warning-surface rounded-xl p-4">
        <h3 class="text-warning-text-strong font-semibold">ゲーム</h3>
        <dl class="mt-3 grid gap-3 text-sm">
          <div class="flex items-start justify-between gap-3">
            <dt class="text-text">総ゲーム回数</dt>
            <dd class="text-warning-text-strong font-bold">
              {formatNumber(stats.games.totalSessions)}
            </dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-text">総回答数</dt>
            <dd class="text-warning-text-strong font-bold">
              {formatNumber(stats.games.totalAnswered)}
            </dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-text">平均正答率</dt>
            <dd class="text-warning-text-strong font-bold">{stats.games.averageAccuracyRate}%</dd>
          </div>
        </dl>
      </article>

      <article class="bg-success-surface rounded-xl p-4">
        <h3 class="text-success-text-strong font-semibold">学習</h3>
        <dl class="mt-3 grid gap-3 text-sm">
          <div class="flex items-start justify-between gap-3">
            <dt class="text-text">苦手元素登録数</dt>
            <dd class="text-success-text-strong font-bold">
              {formatNumber(stats.learning.totalWeakElements)}
            </dd>
          </div>
          <div class="flex items-start justify-between gap-3">
            <dt class="text-text">習得元素数の累計</dt>
            <dd class="text-success-text-strong font-bold">
              {formatNumber(stats.learning.totalMasteredCount)}
            </dd>
          </div>
        </dl>
      </article>
    </div>
  {:else if !isLoading && errorMessage === null}
    <p class="bg-surface-muted text-text-muted mt-4 rounded-xl p-4 text-sm">
      統計情報はまだ読み込まれていません
    </p>
  {/if}
</section>
