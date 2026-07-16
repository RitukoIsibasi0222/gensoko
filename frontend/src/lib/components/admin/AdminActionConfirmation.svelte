<script lang="ts">
  import type { AdminUserRole, AdminUserSummary } from '$lib/api/admin';

  type ConfirmationAction =
    | { type: 'status'; nextIsActive: boolean }
    | { type: 'role'; nextRole: AdminUserRole }
    | { type: 'delete' };

  type Props = {
    user: AdminUserSummary;
    action: ConfirmationAction;
    isSubmitting?: boolean;
    errorMessage?: string | null;
    onConfirm: () => void;
    onCancel: () => void;
  };

  let {
    user,
    action,
    isSubmitting = false,
    errorMessage = null,
    onConfirm,
    onCancel
  }: Props = $props();

  let confirmationText = $state('');
  let previousActionType = $state<ConfirmationAction['type'] | null>(null);

  const canConfirm = $derived(
    !isSubmitting && (action.type !== 'delete' || confirmationText === '強制退会')
  );

  function getCurrentStatus(): string {
    return user.isActive ? '有効' : '停止中';
  }

  function handleConfirm(): void {
    if (!canConfirm) {
      return;
    }
    onConfirm();
  }

  function handleCancel(): void {
    if (isSubmitting) {
      return;
    }
    onCancel();
  }

  $effect(() => {
    const currentActionType = action.type;
    if (previousActionType === null) {
      previousActionType = currentActionType;
    } else if (previousActionType !== currentActionType) {
      previousActionType = currentActionType;
      confirmationText = '';
    }
  });
</script>

<section data-confirmation aria-busy={isSubmitting} class="grid gap-4">
  <div>
    <p class="text-sm text-gray-600">対象ユーザー</p>
    <p class="mt-1 text-lg font-bold text-gray-900">{user.username}</p>
  </div>

  {#if action.type === 'status'}
    <div class="rounded-xl bg-amber-50 p-4">
      <h3 class="font-semibold text-amber-950">アカウント状態を変更</h3>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-gray-600">変更前</dt>
        <dd class="font-semibold text-gray-900">{getCurrentStatus()}</dd>
        <dt class="text-gray-600">変更後</dt>
        <dd class="font-semibold text-gray-900">
          {action.nextIsActive ? '有効' : '停止中'}
        </dd>
      </dl>
    </div>
  {:else if action.type === 'role'}
    <div class="rounded-xl bg-blue-50 p-4">
      <h3 class="font-semibold text-blue-950">ロールを変更</h3>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-gray-600">変更前</dt>
        <dd class="font-semibold text-gray-900">{user.role}</dd>
        <dt class="text-gray-600">変更後</dt>
        <dd class="font-semibold text-gray-900">{action.nextRole}</dd>
      </dl>
    </div>
  {:else}
    <div class="rounded-xl border border-red-200 bg-red-50 p-4">
      <h3 class="font-semibold text-red-900">強制退会</h3>
      <p class="mt-2 text-sm text-red-800">
        対象ユーザーのプロフィール・認証情報・学習データを稼働DBから物理削除します。削除後は取り消せません。
      </p>
      <label
        for="admin-force-delete-confirmation"
        class="mt-4 block text-sm font-semibold text-red-900"
      >
        確認のため「強制退会」と入力
      </label>
      <input
        id="admin-force-delete-confirmation"
        type="text"
        bind:value={confirmationText}
        autocomplete="off"
        spellcheck={false}
        disabled={isSubmitting}
        class="mt-2 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100"
      />
    </div>
  {/if}

  {#if errorMessage !== null}
    <p role="alert" class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {errorMessage || '管理操作を完了できませんでした'}
    </p>
  {/if}

  <div class="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4">
    <button
      type="button"
      data-cancel
      disabled={isSubmitting}
      class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:text-gray-400"
      onclick={handleCancel}
    >
      キャンセル
    </button>
    <button
      type="button"
      data-confirm
      disabled={!canConfirm}
      class={action.type === 'delete'
        ? 'rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:bg-gray-400'
        : 'bg-brand hover:bg-brand-hover rounded-lg px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:bg-gray-400'}
      onclick={handleConfirm}
    >
      {isSubmitting ? '処理中...' : 'この内容で実行'}
    </button>
  </div>
</section>
