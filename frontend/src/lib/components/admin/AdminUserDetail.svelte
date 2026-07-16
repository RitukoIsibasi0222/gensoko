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
    <p aria-live="polite" class="rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
      ユーザー詳細を読み込んでいます...
    </p>
  {:else if errorMessage !== null}
    <div role="alert" class="rounded-xl border border-red-200 bg-red-50 p-4">
      <p class="text-sm text-red-700">
        {errorMessage || 'ユーザー詳細を表示できませんでした'}
      </p>
      {#if onRetry}
        <button
          type="button"
          class="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
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
        <h3 id="admin-user-profile-heading" class="font-semibold text-gray-900">アカウント情報</h3>
        <dl class="mt-3 grid gap-3 rounded-xl bg-gray-50 p-4 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-gray-500">ユーザー名</dt>
            <dd class="mt-1 font-medium text-gray-900">{user.username}</dd>
          </div>
          <div>
            <dt class="text-gray-500">メールアドレス</dt>
            <dd class="mt-1 font-medium break-all text-gray-900">{user.email}</dd>
          </div>
          <div>
            <dt class="text-gray-500">ロール</dt>
            <dd class="mt-1 font-medium text-gray-900">{user.role}</dd>
          </div>
          <div>
            <dt class="text-gray-500">アカウント状態</dt>
            <dd class="mt-1 font-medium text-gray-900">{getAccountStatus(user)}</dd>
          </div>
          <div>
            <dt class="text-gray-500">メール確認</dt>
            <dd class="mt-1 font-medium text-gray-900">
              {user.emailVerified ? '確認済み' : '未確認'}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">ログイン失敗回数</dt>
            <dd class="mt-1 font-medium text-gray-900">{formatNumber(user.loginFailCount)}</dd>
          </div>
          <div>
            <dt class="text-gray-500">最終ログイン</dt>
            <dd class="mt-1 font-medium text-gray-900">{formatDate(user.lastLoginAt)}</dd>
          </div>
          <div>
            <dt class="text-gray-500">ロック期限</dt>
            <dd class="mt-1 font-medium text-gray-900">{formatDate(user.lockedUntil)}</dd>
          </div>
          <div>
            <dt class="text-gray-500">登録日時</dt>
            <dd class="mt-1 font-medium text-gray-900">{formatDate(user.createdAt)}</dd>
          </div>
          <div>
            <dt class="text-gray-500">更新日時</dt>
            <dd class="mt-1 font-medium text-gray-900">{formatDate(user.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="admin-user-learning-heading">
        <h3 id="admin-user-learning-heading" class="font-semibold text-gray-900">学習統計</h3>
        <dl class="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-blue-50 p-4 text-sm sm:grid-cols-3">
          <div>
            <dt class="text-gray-600">累計ゲーム</dt>
            <dd class="mt-1 font-bold text-blue-950">{formatNumber(user.stats.totalGames)}</dd>
          </div>
          <div>
            <dt class="text-gray-600">正答率</dt>
            <dd class="mt-1 font-bold text-blue-950">{user.stats.accuracyRate}%</dd>
          </div>
          <div>
            <dt class="text-gray-600">累計回答</dt>
            <dd class="mt-1 font-bold text-blue-950">{formatNumber(user.stats.totalAnswered)}</dd>
          </div>
          <div>
            <dt class="text-gray-600">習得元素</dt>
            <dd class="mt-1 font-bold text-blue-950">{formatNumber(user.stats.masteredCount)}</dd>
          </div>
          <div>
            <dt class="text-gray-600">現在の連続日数</dt>
            <dd class="mt-1 font-bold text-blue-950">{formatNumber(user.stats.currentStreak)}</dd>
          </div>
          <div>
            <dt class="text-gray-600">最終学習日</dt>
            <dd class="mt-1 font-bold text-blue-950">{formatDate(user.stats.lastActiveDate)}</dd>
          </div>
        </dl>
      </section>

      <div class="flex flex-wrap gap-2 border-t border-gray-200 pt-4">
        <button
          type="button"
          data-action="status"
          aria-describedby={getBlockReasonId(user, 'status')}
          disabled={statusBlockReason !== null}
          class="rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50"
          onclick={() => onAction(user, 'status')}
        >
          {user.isActive ? 'アカウントを停止' : '停止を解除'}
        </button>
        <button
          type="button"
          data-action="role"
          aria-describedby={getBlockReasonId(user, 'role')}
          disabled={roleBlockReason !== null}
          class="rounded-lg border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50"
          onclick={() => onAction(user, 'role')}
        >
          ロールを変更
        </button>
        <button
          type="button"
          data-action="delete"
          aria-describedby={getBlockReasonId(user, 'delete')}
          disabled={deleteBlockReason !== null}
          class="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
          onclick={() => onAction(user, 'delete')}
        >
          強制退会
        </button>
      </div>
      {#if statusBlockReason}
        <p id="admin-detail-status-block-reason" class="text-sm text-gray-600">
          {statusBlockReason}
        </p>
      {/if}
      {#if roleBlockReason && roleBlockReason !== statusBlockReason}
        <p id="admin-detail-role-block-reason" class="text-sm text-gray-600">{roleBlockReason}</p>
      {/if}
      {#if deleteBlockReason && deleteBlockReason !== statusBlockReason}
        <p id="admin-detail-delete-block-reason" class="text-sm text-gray-600">
          {deleteBlockReason}
        </p>
      {/if}
    </div>
  {:else}
    <p class="rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
      ユーザー詳細はまだ読み込まれていません
    </p>
  {/if}
</div>
