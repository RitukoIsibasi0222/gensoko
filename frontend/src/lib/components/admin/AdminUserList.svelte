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
    if (user.deletedAt !== null) {
      return '退会済み';
    }
    return user.isActive ? '有効（未退会）' : '停止中';
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
      class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
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
      class="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
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
      class="rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
      onclick={(event) => handleAction(user, 'role', event)}
    >
      {getRoleActionLabel(user)}
    </button>
    <button
      type="button"
      data-admin-action="delete"
      aria-label={user.username + 'を強制退会'}
      aria-describedby={getBlockReasonId(user, 'delete', view)}
      disabled={getAdminActionBlockReason(user, 'delete', currentUserId) !== null}
      class="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
      onclick={(event) => handleAction(user, 'delete', event)}
    >
      強制退会
    </button>
  </div>
{/snippet}

<section
  aria-labelledby="admin-user-list-heading"
  aria-busy={isLoading || isPageLoading}
  class="rounded-2xl border border-gray-200 bg-white shadow-sm"
>
  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
    <div>
      <p class="text-brand text-sm font-semibold">Users</p>
      <h2
        bind:this={headingElement}
        id="admin-user-list-heading"
        tabindex="-1"
        class="text-ink mt-1 text-xl font-bold"
      >
        ユーザー一覧
      </h2>
    </div>
    {#if users.length > 0}
      <p class="text-sm text-gray-600">このページ: {formatNumber(users.length)}件</p>
    {/if}
  </div>

  {#if isLoading}
    <p aria-live="polite" class="p-5 text-sm text-gray-600">ユーザー一覧を読み込んでいます...</p>
  {:else if users.length === 0}
    <div class="p-6 text-center">
      <p class="text-gray-700">条件に一致するユーザーはいません</p>
      {#if onResetFilters}
        <button
          type="button"
          class="text-brand mt-3 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
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
        <thead class="bg-gray-50 text-xs text-gray-600 uppercase">
          <tr>
            <th scope="col" class="px-4 py-3 font-semibold">ユーザー</th>
            <th scope="col" class="px-4 py-3 font-semibold">状態・ロール</th>
            <th scope="col" class="px-4 py-3 font-semibold">確認・セキュリティ</th>
            <th scope="col" class="px-4 py-3 font-semibold">学習状況</th>
            <th scope="col" class="px-4 py-3 font-semibold">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          {#each users as user (user.id)}
            {@const statusBlockReason = getAdminActionBlockReason(user, 'status', currentUserId)}
            {@const roleBlockReason = getAdminActionBlockReason(user, 'role', currentUserId)}
            {@const deleteBlockReason = getAdminActionBlockReason(user, 'delete', currentUserId)}
            <tr class="align-top">
              <th scope="row" class="px-4 py-4 font-semibold text-gray-900">
                {user.username}
                <span class="mt-1 block text-xs font-normal text-gray-500">
                  登録日 {new Date(user.createdAt).toLocaleDateString('ja-JP')}
                </span>
              </th>
              <td class="px-4 py-4">
                <span class="block font-medium text-gray-800">{getAccountStatus(user)}</span>
                <span class="mt-1 block text-xs text-gray-600">{user.role}</span>
              </td>
              <td class="px-4 py-4">
                <span class="block text-gray-800">
                  {user.emailVerified ? 'メール確認済み' : 'メール未確認'}
                </span>
                {#if isLocked(user)}
                  <span class="mt-1 block text-xs font-semibold text-red-700">ロック中</span>
                {:else}
                  <span class="mt-1 block text-xs text-gray-500">ロックなし</span>
                {/if}
              </td>
              <td class="px-4 py-4 text-gray-700">
                <span class="block">{formatNumber(user.stats.totalGames)}ゲーム</span>
                <span class="mt-1 block text-xs">正答率 {user.stats.accuracyRate}%</span>
              </td>
              <td class="px-4 py-4">
                {@render actionButtons(user, 'desktop')}
                {#if statusBlockReason}
                  <p
                    id={'desktop-' + user.id + '-status-block-reason'}
                    class="mt-2 max-w-xs text-xs text-gray-600"
                  >
                    {statusBlockReason}
                  </p>
                {/if}
                {#if roleBlockReason && roleBlockReason !== statusBlockReason}
                  <p
                    id={'desktop-' + user.id + '-role-block-reason'}
                    class="mt-1 max-w-xs text-xs text-gray-600"
                  >
                    {roleBlockReason}
                  </p>
                {/if}
                {#if deleteBlockReason && deleteBlockReason !== statusBlockReason}
                  <p
                    id={'desktop-' + user.id + '-delete-block-reason'}
                    class="mt-1 max-w-xs text-xs text-gray-600"
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
        <li data-user-id={user.id} class="rounded-xl border border-gray-200 p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold text-gray-900">{user.username}</h3>
              <p class="mt-1 text-xs text-gray-500">
                登録日 {new Date(user.createdAt).toLocaleDateString('ja-JP')}
              </p>
            </div>
            <span class="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-700">
              {user.role}
            </span>
          </div>

          <dl class="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt class="text-gray-500">ロール</dt>
            <dd class="font-medium text-gray-800">{user.role}</dd>
            <dt class="text-gray-500">アカウント状態</dt>
            <dd class="font-medium text-gray-800">{getAccountStatus(user)}</dd>
            <dt class="text-gray-500">メール確認</dt>
            <dd class="text-gray-800">
              {user.emailVerified ? 'メール確認済み' : 'メール未確認'}
            </dd>
            <dt class="text-gray-500">ロック</dt>
            <dd class="text-gray-800">{isLocked(user) ? 'ロック中' : 'ロックなし'}</dd>
            <dt class="text-gray-500">ゲーム回数</dt>
            <dd class="text-gray-800">{formatNumber(user.stats.totalGames)}</dd>
            <dt class="text-gray-500">正答率</dt>
            <dd class="text-gray-800">{user.stats.accuracyRate}%</dd>
          </dl>

          <div class="mt-4">
            {@render actionButtons(user, 'mobile')}
            {#if statusBlockReason}
              <p
                id={'mobile-' + user.id + '-status-block-reason'}
                class="mt-2 text-xs text-gray-600"
              >
                {statusBlockReason}
              </p>
            {/if}
            {#if roleBlockReason && roleBlockReason !== statusBlockReason}
              <p id={'mobile-' + user.id + '-role-block-reason'} class="mt-1 text-xs text-gray-600">
                {roleBlockReason}
              </p>
            {/if}
            {#if deleteBlockReason && deleteBlockReason !== statusBlockReason}
              <p
                id={'mobile-' + user.id + '-delete-block-reason'}
                class="mt-1 text-xs text-gray-600"
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
    <div class="border-t border-gray-100 px-5 py-4">
      {#if paginationError !== null}
        <div class="rounded-xl border border-red-200 bg-red-50 p-3" role="alert">
          <p class="text-sm text-red-700">
            {paginationError || '次のユーザーを読み込めませんでした'}
          </p>
          <button
            type="button"
            disabled={isPageLoading}
            class="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:text-gray-400"
            onclick={onLoadNext}
          >
            再試行
          </button>
          {#if onReturnToFirst}
            <button
              type="button"
              disabled={isPageLoading}
              class="mt-2 ml-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:text-gray-400"
              onclick={onReturnToFirst}
            >
              一覧の先頭へ戻る
            </button>
          {/if}
        </div>
      {/if}

      {#if isPageLoading}
        <p aria-live="polite" class="mt-3 text-sm text-gray-600">
          次のユーザーを読み込んでいます...
        </p>
      {/if}

      {#if nextCursor}
        <div class="mt-3 flex justify-center">
          <button
            type="button"
            disabled={isPageLoading}
            class="bg-brand hover:bg-brand-hover rounded-lg px-5 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:bg-gray-400"
            onclick={onLoadNext}
          >
            {isPageLoading ? '読み込み中...' : '次を読み込む'}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</section>
