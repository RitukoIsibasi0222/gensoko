<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy } from 'svelte';
  import { ApiError } from '$lib/api/errors';
  import { deleteWeakElement, getWeakElements, type WeakElement } from '$lib/api/weak';
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';
  import {
    readWeakSortState,
    sortWeakElements,
    toWeakSortSearchParams,
    type WeakSortKey,
    type WeakSortOrder,
    type WeakSortState
  } from '$lib/weak/sort';

  const NETWORK_ERROR_MESSAGE = 'ネットワークエラーが発生しました。接続を確認してください';

  type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

  let weakElements = $state<WeakElement[]>([]);
  let loadStatus = $state<LoadStatus>('idle');
  let errorMessage = $state<string | null>(null);
  let appliedSortState = $state<WeakSortState>(readWeakSortState(page.url.searchParams));
  let confirmingElementId = $state<number | null>(null);
  let deletingElementIds = $state<Set<number>>(new Set());
  let rowErrors = $state<Record<number, string>>({});

  let activeAbortController: AbortController | null = null;
  let activeRequestKey: string | null = null;
  let loadedRequestKey: string | null = null;

  const sortedWeakElements = $derived(sortWeakElements(weakElements, appliedSortState));
  const isLoading = $derived(loadStatus === 'loading');
  const isEmpty = $derived(loadStatus === 'success' && weakElements.length === 0);

  function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  function clearWeakState(): void {
    activeAbortController?.abort();
    activeAbortController = null;
    activeRequestKey = null;
    loadedRequestKey = null;
    weakElements = [];
    loadStatus = 'idle';
    errorMessage = null;
    confirmingElementId = null;
    deletingElementIds = new Set();
    rowErrors = {};
  }

  async function loadWeakElements(accessToken: string, force = false): Promise<void> {
    const requestKey = accessToken;

    if (!force && (activeRequestKey === requestKey || loadedRequestKey === requestKey)) {
      return;
    }

    activeAbortController?.abort();
    const controller = new AbortController();
    activeAbortController = controller;
    activeRequestKey = requestKey;

    if (force) {
      loadedRequestKey = null;
    }

    loadStatus = 'loading';
    errorMessage = null;

    try {
      const nextWeakElements = await getWeakElements({
        accessToken,
        signal: controller.signal
      });

      if (controller.signal.aborted || activeRequestKey !== requestKey) {
        return;
      }

      weakElements = nextWeakElements;
      loadStatus = 'success';
      errorMessage = null;
      loadedRequestKey = requestKey;
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted || activeRequestKey !== requestKey) {
        return;
      }

      weakElements = [];
      loadStatus = 'error';
      loadedRequestKey = null;
      errorMessage = error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE;
    } finally {
      if (activeRequestKey === requestKey) {
        activeRequestKey = null;
      }

      if (activeAbortController === controller) {
        activeAbortController = null;
      }
    }
  }

  function retryLoadWeakElements(): void {
    if (!authStore.isLoggedIn || !authStore.accessToken) {
      return;
    }

    void loadWeakElements(authStore.accessToken, true);
  }

  function updateSortUrl(sortState: WeakSortState): void {
    const searchParams = toWeakSortSearchParams(sortState);
    const query = searchParams.toString();
    const nextUrl = query === '' ? page.url.pathname : page.url.pathname + '?' + query;

    void goto(nextUrl, {
      replaceState: false,
      noScroll: true,
      keepFocus: true
    });
  }

  function updateSortKey(value: string): void {
    updateSortUrl({ ...appliedSortState, key: value as WeakSortKey });
  }

  function updateSortOrder(value: string): void {
    updateSortUrl({ ...appliedSortState, order: value as WeakSortOrder });
  }

  function setDeleting(elementId: number, isDeleting: boolean): void {
    const nextDeletingIds = new Set(deletingElementIds);

    if (isDeleting) {
      nextDeletingIds.add(elementId);
    } else {
      nextDeletingIds.delete(elementId);
    }

    deletingElementIds = nextDeletingIds;
  }

  function setRowError(elementId: number, message: string | null): void {
    const nextRowErrors = { ...rowErrors };

    if (message === null) {
      delete nextRowErrors[elementId];
    } else {
      nextRowErrors[elementId] = message;
    }

    rowErrors = nextRowErrors;
  }

  function requestDelete(elementId: number): void {
    confirmingElementId = elementId;
    setRowError(elementId, null);
  }

  function cancelDelete(elementId: number): void {
    if (confirmingElementId === elementId) {
      confirmingElementId = null;
    }
  }

  async function confirmDelete(element: WeakElement): Promise<void> {
    if (
      !authStore.isLoggedIn ||
      !authStore.accessToken ||
      deletingElementIds.has(element.elementId)
    ) {
      return;
    }

    setDeleting(element.elementId, true);
    setRowError(element.elementId, null);

    try {
      const result = await deleteWeakElement({
        accessToken: authStore.accessToken,
        elementId: element.elementId
      });

      toastStore.success(result.message);
      confirmingElementId = null;
      await loadWeakElements(authStore.accessToken, true);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '苦手元素を削除できませんでした';
      setRowError(element.elementId, message);
      toastStore.error(message);
    } finally {
      setDeleting(element.elementId, false);
    }
  }

  function formatAddedAt(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }

  $effect(() => {
    appliedSortState = readWeakSortState(page.url.searchParams);

    if (authStore.isInitializing) {
      return;
    }

    if (!authStore.isLoggedIn || !authStore.accessToken) {
      clearWeakState();
      return;
    }

    void loadWeakElements(authStore.accessToken);
  });

  onDestroy(() => {
    activeAbortController?.abort();
  });
</script>

<div class="space-y-6">
  <section class="space-y-2">
    <p class="text-text-subtle text-sm font-semibold">苦手元素</p>
    <h1 class="text-text text-2xl font-bold">苦手リスト</h1>
    <p class="text-text-muted max-w-2xl text-sm leading-6">
      間違えた元素を見直し、必要なくなったものはリストから削除できます。
    </p>
  </section>

  {#if authStore.isInitializing}
    <section
      class="border-border-muted bg-surface rounded border p-5"
      aria-busy="true"
      aria-live="polite"
    >
      <p class="text-text-muted text-sm">ログイン状態を確認しています...</p>
    </section>
  {:else if !authStore.isLoggedIn}
    <section class="border-border-muted bg-surface rounded border p-5">
      <p class="text-text text-sm">苦手リストを見るにはログインが必要です。</p>
      <a
        href="/login"
        class="bg-action text-text-inverse hover:bg-action-hover focus-visible:outline-focus mt-4 inline-flex rounded px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        ログインへ
      </a>
    </section>
  {:else if isLoading}
    <section
      class="border-border-muted bg-surface rounded border p-5"
      aria-busy="true"
      aria-live="polite"
    >
      <p class="text-text-muted text-sm">苦手リストを読み込み中です...</p>
    </section>
  {:else if loadStatus === 'error'}
    <section class="border-danger-border bg-danger-surface rounded border p-5" role="alert">
      <p class="text-danger-text text-sm">{errorMessage}</p>
      <button
        type="button"
        onclick={retryLoadWeakElements}
        class="border-danger-border-strong bg-surface text-danger-text hover:bg-danger-surface-strong focus-visible:outline-danger-border-strong mt-4 rounded border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        再読み込み
      </button>
    </section>
  {:else if isEmpty}
    <section class="border-border-muted bg-surface rounded border p-5">
      <p class="text-text text-sm">苦手元素はまだありません。</p>
      <a
        href="/game"
        class="border-border text-text hover:bg-surface-subtle focus-visible:outline-focus mt-4 inline-flex rounded border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        ゲームで練習する
      </a>
    </section>
  {:else}
    <section class="space-y-4" aria-labelledby="weak-list-heading">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="weak-list-heading" class="text-text text-lg font-bold">一覧</h2>
          <p class="text-text-muted mt-1 text-sm" aria-live="polite">
            {weakElements.length}件の苦手元素
          </p>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <label class="text-text text-sm font-semibold">
            並び替え
            <select
              value={appliedSortState.key}
              onchange={(event) => updateSortKey(event.currentTarget.value)}
              class="border-border bg-surface text-text focus-visible:outline-focus mt-1 block w-full rounded border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <option value="missCount">ミス回数</option>
              <option value="addedAt">追加日</option>
              <option value="elementId">元素番号</option>
              <option value="nameJa">元素名</option>
            </select>
          </label>

          <label class="text-text text-sm font-semibold">
            順序
            <select
              value={appliedSortState.order}
              onchange={(event) => updateSortOrder(event.currentTarget.value)}
              class="border-border bg-surface text-text focus-visible:outline-focus mt-1 block w-full rounded border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <option value="desc">降順</option>
              <option value="asc">昇順</option>
            </select>
          </label>
        </div>
      </div>

      <ul role="list" class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {#each sortedWeakElements as element (element.elementId)}
          {@const isConfirming = confirmingElementId === element.elementId}
          {@const isDeleting = deletingElementIds.has(element.elementId)}
          {@const rowError = rowErrors[element.elementId]}
          <li class="border-border-muted bg-surface rounded border p-4">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <p class="text-text-subtle text-sm font-semibold">No. {element.elementId}</p>
                <p class="text-text mt-1 text-2xl font-bold">{element.symbol}</p>
                <p class="text-text text-sm font-medium">{element.nameJa}</p>
              </div>
              <div class="text-text-muted text-right text-sm">
                <p><span class="text-text font-semibold">{element.missCount}</span> 回ミス</p>
                <p class="mt-1">追加日 {formatAddedAt(element.addedAt)}</p>
              </div>
            </div>

            {#if rowError}
              <p
                class="border-danger-border bg-danger-surface text-danger-text mt-3 rounded border p-2 text-sm"
                role="alert"
              >
                {rowError}
              </p>
            {/if}

            <div class="mt-4">
              {#if isConfirming}
                <div
                  class="border-warning-border bg-warning-surface space-y-3 rounded border p-3"
                  aria-busy={isDeleting}
                  aria-live="polite"
                >
                  <p class="text-warning-text text-sm">
                    {element.nameJa}を苦手リストから削除しますか？
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-label={element.nameJa + 'を苦手リストから削除する'}
                      disabled={isDeleting}
                      onclick={() => confirmDelete(element)}
                      class="bg-danger-solid text-text-inverse hover:bg-danger-solid-hover focus-visible:outline-danger-border-strong rounded px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isDeleting ? '削除中...' : '削除する'}
                    </button>
                    <button
                      type="button"
                      aria-label={element.nameJa + 'の削除をキャンセル'}
                      disabled={isDeleting}
                      onclick={() => cancelDelete(element.elementId)}
                      class="border-border bg-surface text-text hover:bg-surface-subtle focus-visible:outline-focus rounded border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              {:else}
                <button
                  type="button"
                  aria-label={element.nameJa + 'を苦手リストから削除'}
                  disabled={isDeleting}
                  onclick={() => requestDelete(element.elementId)}
                  class="border-border text-text hover:bg-surface-subtle focus-visible:outline-focus rounded border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  リストから削除
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
