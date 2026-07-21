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
    <p class="text-text-muted text-sm">対象ユーザー</p>
    <p class="text-text mt-1 text-lg font-bold">{user.username}</p>
  </div>

  {#if action.type === 'status'}
    <div class="bg-warning-surface rounded-xl p-4">
      <h3 class="text-warning-text-strong font-semibold">アカウント状態を変更</h3>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-text-muted">変更前</dt>
        <dd class="text-text font-semibold">{getCurrentStatus()}</dd>
        <dt class="text-text-muted">変更後</dt>
        <dd class="text-text font-semibold">
          {action.nextIsActive ? '有効' : '停止中'}
        </dd>
      </dl>
    </div>
  {:else if action.type === 'role'}
    <div class="bg-info-surface rounded-xl p-4">
      <h3 class="text-info-text-strong font-semibold">ロールを変更</h3>
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-text-muted">変更前</dt>
        <dd class="text-text font-semibold">{user.role}</dd>
        <dt class="text-text-muted">変更後</dt>
        <dd class="text-text font-semibold">{action.nextRole}</dd>
      </dl>
    </div>
  {:else}
    <div class="border-danger-border bg-danger-surface rounded-xl border p-4">
      <h3 class="text-danger-text-strong font-semibold">強制退会</h3>
      <p class="text-danger-text mt-2 text-sm">
        対象ユーザーのプロフィール・認証情報・学習データを稼働DBから物理削除します。削除後は取り消せません。
      </p>
      <label
        for="admin-force-delete-confirmation"
        class="text-danger-text-strong mt-4 block text-sm font-semibold"
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
        class="border-danger-border-strong bg-surface focus:border-danger-border-strong focus:ring-danger-border-strong disabled:bg-surface-subtle mt-2 w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none disabled:cursor-not-allowed"
      />
    </div>
  {/if}

  {#if errorMessage !== null}
    <p
      role="alert"
      class="border-danger-border bg-danger-surface text-danger-text rounded-xl border p-3 text-sm"
    >
      {errorMessage || '管理操作を完了できませんでした'}
    </p>
  {/if}

  <div class="border-border-muted flex flex-wrap justify-end gap-2 border-t pt-4">
    <button
      type="button"
      data-cancel
      disabled={isSubmitting}
      class="border-border text-text hover:bg-surface-muted focus-visible:outline-focus disabled:text-text-disabled rounded-lg border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed"
      onclick={handleCancel}
    >
      キャンセル
    </button>
    <button
      type="button"
      data-confirm
      disabled={!canConfirm}
      class={action.type === 'delete'
        ? 'bg-danger-solid text-text-inverse hover:bg-danger-solid-hover focus-visible:outline-danger-border-strong disabled:bg-disabled-solid rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed'
        : 'bg-action hover:bg-action-hover text-text-inverse focus-visible:outline-focus disabled:bg-disabled-solid rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed'}
      onclick={handleConfirm}
    >
      {isSubmitting ? '処理中...' : 'この内容で実行'}
    </button>
  </div>
</section>
