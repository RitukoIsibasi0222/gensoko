<script lang="ts">
  import type { AdminUserDetail } from '$lib/api/admin';
  import { getAdminActionBlockReason, type AdminListAction } from '$lib/admin/actions';

  /* eslint-disable no-unused-vars -- Svelte parserがcallback型の引数名を実変数として判定するため */
  type Props = {
    user: AdminUserDetail | null;
    isLoading?: boolean;
    errorMessage?: string | null;
    currentUserId?: string;
    onRetry?: () => void;
    onAction: (user: AdminUserDetail, action: AdminListAction) => void;
  };
  /* eslint-enable no-unused-vars */

  let {
    user,
    isLoading = false,
    errorMessage = null,
    currentUserId,
    onRetry,
    onAction
  }: Props = $props();

  function formatNumber(value: number): string {
    return value.toLocaleString('ja-JP');
  }

  function formatDate(value: string | null): string {
    return value === null ? '未記録' : new Date(value).toLocaleString('ja-JP');
  }

  function getAccountStatus(detail: AdminUserDetail): string {
    return detail.isActive ? '有効' : '停止中';
  }

  function getBlockReasonId(detail: AdminUserDetail, action: AdminListAction): string | undefined {
    const reason = getAdminActionBlockReason(detail, action, currentUserId);
    if (reason === null) {
      return undefined;
    }
    const statusReason = getAdminActionBlockReason(detail, 'status', currentUserId);
    const reasonKey = reason === statusReason ? 'status' : action;
    return 'admin-detail-' + reasonKey + '-block-reason';
  }
</script>

<div aria-busy={isLoading}>
  {#if isLoading}
    <p aria-live="polite" class="bg-surface-muted text-text-muted rounded-xl p-4 text-sm">
      ユーザー詳細を読み込んでいます...
    </p>
  {:else if errorMessage !== null}
    <div role="alert" class="border-danger-border bg-danger-surface rounded-xl border p-4">
      <p class="text-danger-text text-sm">
        {errorMessage || 'ユーザー詳細を表示できませんでした'}
      </p>
      {#if onRetry}
        <button
          type="button"
          class="border-danger-border-strong bg-surface text-danger-text hover:bg-danger-surface-strong focus-visible:outline-danger-border-strong mt-3 rounded-lg border px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
          onclick={onRetry}
        >
          詳細を再読み込み
        </button>
      {/if}
    </div>
  {:else if user}
    {@const statusBlockReason = getAdminActionBlockReason(user, 'status', currentUserId)}
    {@const roleBlockReason = getAdminActionBlockReason(user, 'role', currentUserId)}
    {@const deleteBlockReason = getAdminActionBlockReason(user, 'delete', currentUserId)}
    <div class="grid gap-5">
      <section aria-labelledby="admin-user-profile-heading">
        <h3 id="admin-user-profile-heading" class="text-text font-semibold">アカウント情報</h3>
        <dl class="bg-surface-muted mt-3 grid gap-3 rounded-xl p-4 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-text-subtle">ユーザー名</dt>
            <dd class="text-text mt-1 font-medium">{user.username}</dd>
          </div>
          <div>
            <dt class="text-text-subtle">メールアドレス</dt>
            <dd class="text-text mt-1 font-medium break-all">{user.email}</dd>
          </div>
          <div>
            <dt class="text-text-subtle">ロール</dt>
            <dd class="text-text mt-1 font-medium">{user.role}</dd>
          </div>
          <div>
            <dt class="text-text-subtle">アカウント状態</dt>
            <dd class="text-text mt-1 font-medium">{getAccountStatus(user)}</dd>
          </div>
          <div>
            <dt class="text-text-subtle">メール確認</dt>
            <dd class="text-text mt-1 font-medium">
              {user.emailVerified ? '確認済み' : '未確認'}
            </dd>
          </div>
          <div>
            <dt class="text-text-subtle">ログイン失敗回数</dt>
            <dd class="text-text mt-1 font-medium">{formatNumber(user.loginFailCount)}</dd>
          </div>
          <div>
            <dt class="text-text-subtle">最終ログイン</dt>
            <dd class="text-text mt-1 font-medium">{formatDate(user.lastLoginAt)}</dd>
          </div>
          <div>
            <dt class="text-text-subtle">ロック期限</dt>
            <dd class="text-text mt-1 font-medium">{formatDate(user.lockedUntil)}</dd>
          </div>
          <div>
            <dt class="text-text-subtle">登録日時</dt>
            <dd class="text-text mt-1 font-medium">{formatDate(user.createdAt)}</dd>
          </div>
          <div>
            <dt class="text-text-subtle">更新日時</dt>
            <dd class="text-text mt-1 font-medium">{formatDate(user.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="admin-user-learning-heading">
        <h3 id="admin-user-learning-heading" class="text-text font-semibold">学習統計</h3>
        <dl
          class="bg-info-surface mt-3 grid grid-cols-2 gap-3 rounded-xl p-4 text-sm sm:grid-cols-3"
        >
          <div>
            <dt class="text-text-muted">累計ゲーム</dt>
            <dd class="text-info-text-strong mt-1 font-bold">
              {formatNumber(user.stats.totalGames)}
            </dd>
          </div>
          <div>
            <dt class="text-text-muted">正答率</dt>
            <dd class="text-info-text-strong mt-1 font-bold">{user.stats.accuracyRate}%</dd>
          </div>
          <div>
            <dt class="text-text-muted">累計回答</dt>
            <dd class="text-info-text-strong mt-1 font-bold">
              {formatNumber(user.stats.totalAnswered)}
            </dd>
          </div>
          <div>
            <dt class="text-text-muted">習得元素</dt>
            <dd class="text-info-text-strong mt-1 font-bold">
              {formatNumber(user.stats.masteredCount)}
            </dd>
          </div>
          <div>
            <dt class="text-text-muted">現在の連続日数</dt>
            <dd class="text-info-text-strong mt-1 font-bold">
              {formatNumber(user.stats.currentStreak)}
            </dd>
          </div>
          <div>
            <dt class="text-text-muted">最終学習日</dt>
            <dd class="text-info-text-strong mt-1 font-bold">
              {formatDate(user.stats.lastActiveDate)}
            </dd>
          </div>
        </dl>
      </section>

      <div class="border-border-muted flex flex-wrap gap-2 border-t pt-4">
        <button
          type="button"
          data-action="status"
          aria-describedby={getBlockReasonId(user, 'status')}
          disabled={statusBlockReason !== null}
          class="border-warning-border-strong text-warning-text hover:bg-warning-surface rounded-lg border px-3 py-2 text-sm font-semibold"
          onclick={() => onAction(user, 'status')}
        >
          {user.isActive ? 'アカウントを停止' : '停止を解除'}
        </button>
        <button
          type="button"
          data-action="role"
          aria-describedby={getBlockReasonId(user, 'role')}
          disabled={roleBlockReason !== null}
          class="border-info-border-strong text-info-text hover:bg-info-surface rounded-lg border px-3 py-2 text-sm font-semibold"
          onclick={() => onAction(user, 'role')}
        >
          ロールを変更
        </button>
        <button
          type="button"
          data-action="delete"
          aria-describedby={getBlockReasonId(user, 'delete')}
          disabled={deleteBlockReason !== null}
          class="border-danger-border-strong text-danger-text hover:bg-danger-surface rounded-lg border px-3 py-2 text-sm font-semibold"
          onclick={() => onAction(user, 'delete')}
        >
          強制退会
        </button>
      </div>
      {#if statusBlockReason}
        <p id="admin-detail-status-block-reason" class="text-text-muted text-sm">
          {statusBlockReason}
        </p>
      {/if}
      {#if roleBlockReason && roleBlockReason !== statusBlockReason}
        <p id="admin-detail-role-block-reason" class="text-text-muted text-sm">{roleBlockReason}</p>
      {/if}
      {#if deleteBlockReason && deleteBlockReason !== statusBlockReason}
        <p id="admin-detail-delete-block-reason" class="text-text-muted text-sm">
          {deleteBlockReason}
        </p>
      {/if}
    </div>
  {:else}
    <p class="bg-surface-muted text-text-muted rounded-xl p-4 text-sm">
      ユーザー詳細はまだ読み込まれていません
    </p>
  {/if}
</div>
