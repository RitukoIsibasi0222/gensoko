<script lang="ts">
  import type { AdminUserRole, AdminUserStatus } from '$lib/api/admin';
  import { normalizeAdminSearchInput } from '$lib/admin/query';

  /* eslint-disable no-unused-vars -- Svelte parserがcallback型の引数名を実変数として判定するため */
  type Props = {
    searchDraft: string;
    role?: AdminUserRole;
    status?: AdminUserStatus;
    isLoading?: boolean;
    onSearch: (q: string | undefined) => void;
    onRoleChange: (role: AdminUserRole | undefined) => void;
    onStatusChange: (status: AdminUserStatus | undefined) => void;
    onReset: () => void;
  };
  /* eslint-enable no-unused-vars */

  let {
    searchDraft,
    role,
    status,
    isLoading = false,
    onSearch,
    onRoleChange,
    onStatusChange,
    onReset
  }: Props = $props();

  let searchValue = $state('');
  let searchError = $state<string | null>(null);
  let isComposing = $state(false);

  $effect(() => {
    searchValue = searchDraft;
  });

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    if (isLoading) {
      return;
    }

    const result = normalizeAdminSearchInput(searchValue);
    if (!result.success) {
      searchError = result.message;
      return;
    }

    searchError = null;
    searchValue = result.value ?? '';
    onSearch(result.value);
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (isComposing || event.isComposing)) {
      event.preventDefault();
    }
  }

  function handleRoleChange(event: Event): void {
    if (isLoading) {
      return;
    }

    const value = (event.currentTarget as HTMLSelectElement).value;
    onRoleChange(value === 'USER' || value === 'ADMIN' ? value : undefined);
  }

  function handleStatusChange(event: Event): void {
    if (isLoading) {
      return;
    }

    const value = (event.currentTarget as HTMLSelectElement).value;
    onStatusChange(
      value === 'active' || value === 'suspended' || value === 'deleted' ? value : undefined
    );
  }

  function handleReset(): void {
    if (isLoading) {
      return;
    }

    searchValue = '';
    searchError = null;
    onReset();
  }
</script>

<form
  class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
  aria-busy={isLoading}
  onsubmit={handleSubmit}
>
  <div class="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(10rem,1fr)_minmax(11rem,1fr)]">
    <div>
      <label for="admin-user-search" class="text-ink block text-sm font-semibold">
        ユーザー名またはメールアドレス
      </label>
      <div class="mt-2 flex gap-2">
        <input
          id="admin-user-search"
          type="search"
          bind:value={searchValue}
          maxlength="101"
          autocomplete="off"
          disabled={isLoading}
          aria-describedby={searchError ? 'admin-user-search-error' : undefined}
          aria-invalid={searchError !== null}
          class="focus:border-brand focus:ring-brand min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100"
          placeholder="検索語を入力"
          oncompositionstart={() => (isComposing = true)}
          oncompositionend={() => (isComposing = false)}
          onkeydown={handleSearchKeydown}
        />
        <button
          type="submit"
          disabled={isLoading}
          class="bg-brand hover:bg-brand-hover rounded-lg px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          検索
        </button>
      </div>
      {#if searchError}
        <p id="admin-user-search-error" role="alert" class="mt-2 text-sm text-red-600">
          {searchError}
        </p>
      {/if}
    </div>

    <div>
      <label for="admin-user-role" class="text-ink block text-sm font-semibold">ロール</label>
      <select
        id="admin-user-role"
        value={role ?? ''}
        disabled={isLoading}
        onchange={handleRoleChange}
        class="focus:border-brand focus:ring-brand mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100"
      >
        <option value="">すべてのロール</option>
        <option value="USER">USER</option>
        <option value="ADMIN">ADMIN</option>
      </select>
    </div>

    <div>
      <label for="admin-user-status" class="text-ink block text-sm font-semibold">
        アカウント状態
      </label>
      <select
        id="admin-user-status"
        value={status ?? ''}
        disabled={isLoading}
        onchange={handleStatusChange}
        class="focus:border-brand focus:ring-brand mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:ring-1 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100"
      >
        <option value="">すべての状態</option>
        <option value="active">有効（未退会）</option>
        <option value="suspended">停止中</option>
        <option value="deleted">退会済み</option>
      </select>
    </div>
  </div>

  <div class="mt-4 flex justify-end">
    <button
      type="button"
      disabled={isLoading}
      onclick={handleReset}
      class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
    >
      条件をリセット
    </button>
  </div>
</form>
