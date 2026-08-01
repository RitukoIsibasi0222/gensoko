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
    onStatusChange(value === 'active' || value === 'suspended' ? value : undefined);
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
  class="border-border-muted bg-surface rounded-2xl border p-5 shadow-sm"
  aria-busy={isLoading}
  onsubmit={handleSubmit}
>
  <div class="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(10rem,1fr)_minmax(11rem,1fr)]">
    <div>
      <label for="admin-user-search" class="text-text block text-sm font-semibold">
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
          class="focus:border-brand focus:ring-brand border-border disabled:bg-surface-subtle min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none disabled:cursor-not-allowed"
          placeholder="検索語を入力"
          oncompositionstart={() => (isComposing = true)}
          oncompositionend={() => (isComposing = false)}
          onkeydown={handleSearchKeydown}
        />
        <button
          type="submit"
          disabled={isLoading}
          class="bg-action hover:bg-action-hover text-text-inverse focus-visible:outline-focus disabled:bg-disabled-solid rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
        >
          検索
        </button>
      </div>
      {#if searchError}
        <p id="admin-user-search-error" role="alert" class="text-danger-text mt-2 text-sm">
          {searchError}
        </p>
      {/if}
    </div>

    <div>
      <label for="admin-user-role" class="text-text block text-sm font-semibold">ロール</label>
      <select
        id="admin-user-role"
        value={role ?? ''}
        disabled={isLoading}
        onchange={handleRoleChange}
        class="focus:border-brand focus:ring-brand border-border bg-surface disabled:bg-surface-subtle mt-2 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none disabled:cursor-not-allowed"
      >
        <option value="">すべてのロール</option>
        <option value="USER">USER</option>
        <option value="ADMIN">ADMIN</option>
      </select>
    </div>

    <div>
      <label for="admin-user-status" class="text-text block text-sm font-semibold">
        アカウント状態
      </label>
      <select
        id="admin-user-status"
        value={status ?? ''}
        disabled={isLoading}
        onchange={handleStatusChange}
        class="focus:border-brand focus:ring-brand border-border bg-surface disabled:bg-surface-subtle mt-2 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none disabled:cursor-not-allowed"
      >
        <option value="">すべての状態</option>
        <option value="active">有効</option>
        <option value="suspended">停止中</option>
      </select>
    </div>
  </div>

  <div class="mt-4 flex justify-end">
    <button
      type="button"
      disabled={isLoading}
      onclick={handleReset}
      class="border-border text-text hover:bg-surface-muted focus-visible:outline-focus disabled:bg-surface-subtle rounded-lg border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
    >
      条件をリセット
    </button>
  </div>
</form>
