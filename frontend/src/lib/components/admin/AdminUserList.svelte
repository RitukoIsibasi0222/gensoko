<script lang="ts">
  import type { AdminUserListItem } from '$lib/api/admin';
  import { getAdminActionBlockReason, type AdminListAction } from '$lib/admin/actions';

  /* eslint-disable no-unused-vars -- Svelte parserがcallback型の引数名を実変数として判定するため */
  type Props = {
    users: AdminUserListItem[];
    currentUserId?: string;
    nextCursor: string | null;
    isLoading?: boolean;
    isPageLoading?: boolean;
    paginationError?: string | null;
    headingElement?: HTMLElement;
    onViewDetail: (user: AdminUserListItem, trigger: HTMLElement) => void;
    onAction: (user: AdminUserListItem, action: AdminListAction, trigger: HTMLElement) => void;
    onLoadNext: () => void;
    onReturnToFirst?: () => void;
    onResetFilters?: () => void;
  };
  /* eslint-enable no-unused-vars */

  let {
    users,
    currentUserId,
    nextCursor,
    isLoading = false,
    isPageLoading = false,
    paginationError = null,
    headingElement = $bindable(),
    onViewDetail,
    onAction,
    onLoadNext,
    onReturnToFirst,
    onResetFilters
  }: Props = $props();

  function formatNumber(value: number): string {
    return value.toLocaleString('ja-JP');
  }

  function getAccountStatus(user: AdminUserListItem): string {
    return user.isActive ? '有効' : '停止中';
  }

  function isLocked(user: AdminUserListItem): boolean {
    return user.lockedUntil !== null && Date.parse(user.lockedUntil) > Date.now();
  }

  function getStatusActionLabel(user: AdminUserListItem): string {
    return user.isActive ? 'アカウントを停止' : 'アカウント停止を解除';
  }

  function getRoleActionLabel(user: AdminUserListItem): string {
    return user.role === 'USER' ? 'ADMINに変更' : 'USERに変更';
  }

  function getBlockReasonId(
    user: AdminUserListItem,
    action: AdminListAction,
    view: 'desktop' | 'mobile'
  ): string | undefined {
    const reason = getAdminActionBlockReason(user, action, currentUserId);
    if (reason === null) {
      return undefined;
    }
    const statusReason = getAdminActionBlockReason(user, 'status', currentUserId);
    const reasonKey = reason === statusReason ? 'status' : action;
    return view + '-' + user.id + '-' + reasonKey + '-block-reason';
  }

  function handleDetail(user: AdminUserListItem, event: MouseEvent): void {
    onViewDetail(user, event.currentTarget as HTMLElement);
  }

  function handleAction(user: AdminUserListItem, action: AdminListAction, event: MouseEvent): void {
    if (getAdminActionBlockReason(user, action, currentUserId)) {
      return;
    }
    onAction(user, action, event.currentTarget as HTMLElement);
  }
</script>

{#snippet actionButtons(user: AdminUserListItem, view: 'desktop' | 'mobile')}
  <div class="flex flex-wrap gap-2">
    <button
      type="button"
      aria-label={user.username + 'の詳細を表示'}
      class="border-border text-text hover:bg-surface-muted focus-visible:outline-focus rounded-lg border px-3 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
      onclick={(event) => handleDetail(user, event)}
    >
      詳細
    </button>
    <button
      type="button"
      data-admin-action="status"
      aria-label={user.username + 'の' + getStatusActionLabel(user)}
      aria-describedby={getBlockReasonId(user, 'status', view)}
      disabled={getAdminActionBlockReason(user, 'status', currentUserId) !== null}
      class="border-warning-border-strong text-warning-text hover:bg-warning-surface focus-visible:outline-warning-border-strong disabled:border-border-muted disabled:text-text-disabled rounded-lg border px-3 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
      onclick={(event) => handleAction(user, 'status', event)}
    >
      {user.isActive ? '停止' : '停止解除'}
    </button>
    <button
      type="button"
      data-admin-action="role"
      aria-label={user.username + 'のロールを' + getRoleActionLabel(user)}
      aria-describedby={getBlockReasonId(user, 'role', view)}
      disabled={getAdminActionBlockReason(user, 'role', currentUserId) !== null}
      class="border-info-border-strong text-info-text hover:bg-info-surface focus-visible:outline-focus disabled:border-border-muted disabled:text-text-disabled rounded-lg border px-3 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
      onclick={(event) => handleAction(user, 'role', event)}
    >
      {getRoleActionLabel(user)}
    </button>
    <button
      type="button"
      data-admin-action="delete"
      data-admin-view={view}
      data-admin-user-id={user.id}
      aria-label={user.username + 'を強制退会'}
      aria-describedby={getBlockReasonId(user, 'delete', view)}
      disabled={getAdminActionBlockReason(user, 'delete', currentUserId) !== null}
      class="border-danger-border-strong text-danger-text hover:bg-danger-surface focus-visible:outline-danger-border-strong disabled:border-border-muted disabled:text-text-disabled rounded-lg border px-3 py-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
      onclick={(event) => handleAction(user, 'delete', event)}
    >
      強制退会
    </button>
  </div>
{/snippet}

<section
  aria-labelledby="admin-user-list-heading"
  aria-busy={isLoading || isPageLoading}
  class="border-border-muted bg-surface rounded-2xl border shadow-sm"
>
  <div
    class="border-border-muted flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
  >
    <div>
      <p class="text-brand text-sm font-semibold">Users</p>
      <h2
        bind:this={headingElement}
        id="admin-user-list-heading"
        tabindex="-1"
        class="text-text mt-1 text-xl font-bold"
      >
        ユーザー一覧
      </h2>
    </div>
    {#if users.length > 0}
      <p class="text-text-muted text-sm">このページ: {formatNumber(users.length)}件</p>
    {/if}
  </div>

  {#if isLoading}
    <p aria-live="polite" class="text-text-muted p-5 text-sm">ユーザー一覧を読み込んでいます...</p>
  {:else if users.length === 0}
    <div class="p-6 text-center">
      <p class="text-text">条件に一致するユーザーはいません</p>
      {#if onResetFilters}
        <button
          type="button"
          class="text-brand hover:bg-info-surface focus-visible:outline-focus mt-3 rounded-lg px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
          onclick={onResetFilters}
        >
          条件をリセット
        </button>
      {/if}
    </div>
  {:else}
    <div class="hidden overflow-x-auto md:block">
      <table class="min-w-full border-collapse text-left text-sm">
        <caption class="sr-only">管理対象ユーザー</caption>
        <thead class="bg-surface-muted text-text-muted text-xs uppercase">
          <tr>
            <th scope="col" class="px-4 py-3 font-semibold">ユーザー</th>
            <th scope="col" class="px-4 py-3 font-semibold">状態・ロール</th>
            <th scope="col" class="px-4 py-3 font-semibold">確認・セキュリティ</th>
            <th scope="col" class="px-4 py-3 font-semibold">学習状況</th>
            <th scope="col" class="px-4 py-3 font-semibold">操作</th>
          </tr>
        </thead>
        <tbody class="divide-border-muted divide-y">
          {#each users as user (user.id)}
            {@const statusBlockReason = getAdminActionBlockReason(user, 'status', currentUserId)}
            {@const roleBlockReason = getAdminActionBlockReason(user, 'role', currentUserId)}
            {@const deleteBlockReason = getAdminActionBlockReason(user, 'delete', currentUserId)}
            <tr class="align-top">
              <th scope="row" class="text-text px-4 py-4 font-semibold">
                {user.username}
                <span class="text-text-subtle mt-1 block text-xs font-normal">
                  登録日 {new Date(user.createdAt).toLocaleDateString('ja-JP')}
                </span>
              </th>
              <td class="px-4 py-4">
                <span class="text-text block font-medium">{getAccountStatus(user)}</span>
                <span class="text-text-muted mt-1 block text-xs">{user.role}</span>
              </td>
              <td class="px-4 py-4">
                <span class="text-text block">
                  {user.emailVerified ? 'メール確認済み' : 'メール未確認'}
                </span>
                {#if isLocked(user)}
                  <span class="text-danger-text mt-1 block text-xs font-semibold">ロック中</span>
                {:else}
                  <span class="text-text-subtle mt-1 block text-xs">ロックなし</span>
                {/if}
              </td>
              <td class="text-text px-4 py-4">
                <span class="block">{formatNumber(user.stats.totalGames)}ゲーム</span>
                <span class="mt-1 block text-xs">正答率 {user.stats.accuracyRate}%</span>
              </td>
              <td class="px-4 py-4">
                {@render actionButtons(user, 'desktop')}
                {#if statusBlockReason}
                  <p
                    id={'desktop-' + user.id + '-status-block-reason'}
                    class="text-text-muted mt-2 max-w-xs text-xs"
                  >
                    {statusBlockReason}
                  </p>
                {/if}
                {#if roleBlockReason && roleBlockReason !== statusBlockReason}
                  <p
                    id={'desktop-' + user.id + '-role-block-reason'}
                    class="text-text-muted mt-1 max-w-xs text-xs"
                  >
                    {roleBlockReason}
                  </p>
                {/if}
                {#if deleteBlockReason && deleteBlockReason !== statusBlockReason}
                  <p
                    id={'desktop-' + user.id + '-delete-block-reason'}
                    class="text-text-muted mt-1 max-w-xs text-xs"
                  >
                    {deleteBlockReason}
                  </p>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <ul data-mobile-admin-list class="grid gap-3 p-4 md:hidden">
      {#each users as user (user.id)}
        {@const statusBlockReason = getAdminActionBlockReason(user, 'status', currentUserId)}
        {@const roleBlockReason = getAdminActionBlockReason(user, 'role', currentUserId)}
        {@const deleteBlockReason = getAdminActionBlockReason(user, 'delete', currentUserId)}
        <li data-user-id={user.id} class="border-border-muted rounded-xl border p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-text font-semibold">{user.username}</h3>
              <p class="text-text-subtle mt-1 text-xs">
                登録日 {new Date(user.createdAt).toLocaleDateString('ja-JP')}
              </p>
            </div>
            <span class="bg-surface-subtle text-text rounded-full px-2 py-1 text-xs font-semibold">
              {user.role}
            </span>
          </div>

          <dl class="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt class="text-text-subtle">ロール</dt>
            <dd class="text-text font-medium">{user.role}</dd>
            <dt class="text-text-subtle">アカウント状態</dt>
            <dd class="text-text font-medium">{getAccountStatus(user)}</dd>
            <dt class="text-text-subtle">メール確認</dt>
            <dd class="text-text">
              {user.emailVerified ? 'メール確認済み' : 'メール未確認'}
            </dd>
            <dt class="text-text-subtle">ロック</dt>
            <dd class="text-text">{isLocked(user) ? 'ロック中' : 'ロックなし'}</dd>
            <dt class="text-text-subtle">ゲーム回数</dt>
            <dd class="text-text">{formatNumber(user.stats.totalGames)}</dd>
            <dt class="text-text-subtle">正答率</dt>
            <dd class="text-text">{user.stats.accuracyRate}%</dd>
          </dl>

          <div class="mt-4">
            {@render actionButtons(user, 'mobile')}
            {#if statusBlockReason}
              <p
                id={'mobile-' + user.id + '-status-block-reason'}
                class="text-text-muted mt-2 text-xs"
              >
                {statusBlockReason}
              </p>
            {/if}
            {#if roleBlockReason && roleBlockReason !== statusBlockReason}
              <p
                id={'mobile-' + user.id + '-role-block-reason'}
                class="text-text-muted mt-1 text-xs"
              >
                {roleBlockReason}
              </p>
            {/if}
            {#if deleteBlockReason && deleteBlockReason !== statusBlockReason}
              <p
                id={'mobile-' + user.id + '-delete-block-reason'}
                class="text-text-muted mt-1 text-xs"
              >
                {deleteBlockReason}
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if users.length > 0}
    <div class="border-border-muted border-t px-5 py-4">
      {#if paginationError !== null}
        <div class="border-danger-border bg-danger-surface rounded-xl border p-3" role="alert">
          <p class="text-danger-text text-sm">
            {paginationError || '次のユーザーを読み込めませんでした'}
          </p>
          <button
            type="button"
            disabled={isPageLoading}
            class="border-danger-border-strong bg-surface text-danger-text hover:bg-danger-surface-strong focus-visible:outline-danger-border-strong disabled:text-text-disabled mt-2 rounded-lg border px-3 py-1.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
            onclick={onLoadNext}
          >
            再試行
          </button>
          {#if onReturnToFirst}
            <button
              type="button"
              disabled={isPageLoading}
              class="border-border bg-surface text-text hover:bg-surface-subtle focus-visible:outline-focus disabled:text-text-disabled mt-2 ml-2 rounded-lg border px-3 py-1.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
              onclick={onReturnToFirst}
            >
              一覧の先頭へ戻る
            </button>
          {/if}
        </div>
      {/if}

      {#if isPageLoading}
        <p aria-live="polite" class="text-text-muted mt-3 text-sm">
          次のユーザーを読み込んでいます...
        </p>
      {/if}

      {#if nextCursor}
        <div class="mt-3 flex justify-center">
          <button
            type="button"
            disabled={isPageLoading}
            class="bg-action hover:bg-action-hover text-text-inverse focus-visible:outline-focus disabled:bg-disabled-solid rounded-lg px-5 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
            onclick={onLoadNext}
          >
            {isPageLoading ? '読み込み中...' : '次を読み込む'}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</section>
