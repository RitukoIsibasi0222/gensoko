<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, untrack } from 'svelte';
  import ElementDetailModal from '$lib/components/elements/ElementDetailModal.svelte';
  import ElementMasteryBadge from '$lib/components/elements/ElementMasteryBadge.svelte';
  import ElementSearchFilters from '$lib/components/elements/ElementSearchFilters.svelte';
  import { getElements } from '$lib/api/elements';
  import { ApiError } from '$lib/api/errors';
  import { getElementCategoryStyle } from '$lib/elements/category-style';
  import { getElementMasteryBadgeView } from '$lib/elements/mastery-badge';
  import {
    DEFAULT_ELEMENT_SEARCH_FILTERS,
    hasActiveElementSearchFilters,
    readElementSearchFilters,
    toElementSearchParams
  } from '$lib/elements/search-filter';
  import type { ElementSearchFilters as ElementSearchFilterState } from '$lib/elements/search-filter';
  import type { Element } from '$lib/elements/types';
  import { authStore } from '$lib/stores/auth.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';

  const NETWORK_ERROR_MESSAGE = 'ネットワークエラーが発生しました。接続を確認してください';

  type LoadElementsOptions = {
    showToast?: boolean;
    accessToken?: string | null;
    filters?: ElementSearchFilterState;
  };

  let elements = $state<Element[]>([]);
  let isInitialLoading = $state(true);
  let isSearching = $state(false);
  let errorMessage = $state<string | null>(null);
  let selectedElement = $state<Element | null>(null);
  let returnFocusEl: HTMLElement | null = null;
  let lastRequestKey = '';
  let requestSequence = 0;
  let activeAbortController: AbortController | null = null;
  let appliedFilters = $state<ElementSearchFilterState>(
    readElementSearchFilters(page.url.searchParams)
  );

  const hasActiveFilters = $derived(hasActiveElementSearchFilters(appliedFilters));
  const isUpdatingWithoutResults = $derived(
    !isInitialLoading && errorMessage === null && isSearching && elements.length === 0
  );
  const isEmpty = $derived(
    !isInitialLoading &&
      !isSearching &&
      errorMessage === null &&
      elements.length === 0 &&
      !hasActiveFilters
  );
  const isSearchEmpty = $derived(
    !isInitialLoading &&
      !isSearching &&
      errorMessage === null &&
      elements.length === 0 &&
      hasActiveFilters
  );

  $effect(() => {
    if (authStore.isInitializing) {
      return;
    }

    const nextFilters = readElementSearchFilters(page.url.searchParams);
    const query = toElementSearchParams(nextFilters).toString();
    const accessToken = authStore.isLoggedIn ? authStore.accessToken : null;
    const authRequestKey = authStore.isLoggedIn ? (accessToken ?? 'authenticated') : 'anonymous';
    const requestKey = `${authRequestKey}:${query}`;
    if (requestKey === lastRequestKey) {
      return;
    }

    lastRequestKey = requestKey;
    appliedFilters = nextFilters;
    untrack(() => {
      closeModalIfOpen();
    });

    void loadElements({ accessToken, filters: nextFilters });
  });

  onDestroy(() => {
    activeAbortController?.abort();
  });

  function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  async function loadElements({
    showToast = false,
    accessToken = authStore.isLoggedIn ? authStore.accessToken : null,
    filters = appliedFilters
  }: LoadElementsOptions = {}): Promise<void> {
    activeAbortController?.abort();
    const abortController = new AbortController();
    activeAbortController = abortController;
    const requestId = requestSequence + 1;
    requestSequence = requestId;

    if (!isInitialLoading) {
      isSearching = true;
    }
    errorMessage = null;

    try {
      const nextElements = await getElements({
        accessToken,
        filters,
        signal: abortController.signal
      });
      if (requestId !== requestSequence) {
        return;
      }

      elements = nextElements;
    } catch (error) {
      if (isAbortError(error) || requestId !== requestSequence) {
        return;
      }

      const message = error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE;
      errorMessage = message;
      elements = [];

      if (showToast) {
        toastStore.error(message);
      }
    } finally {
      if (requestId === requestSequence) {
        isInitialLoading = false;
        isSearching = false;
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
      }
    }
  }

  function openModal(element: Element, event: MouseEvent): void {
    const currentTarget = event.currentTarget;
    returnFocusEl = currentTarget instanceof HTMLElement ? currentTarget : null;
    selectedElement = element;
  }

  function getElementCardAriaLabel(element: Element): string {
    const detailLabel = `${element.id}番 ${element.symbol} ${element.nameJa} の詳細を開く`;
    if (!authStore.isLoggedIn || !element.masteryStatus) {
      return detailLabel;
    }

    return `${detailLabel}。${getElementMasteryBadgeView(element.masteryStatus).ariaLabel}`;
  }

  function closeModal(): void {
    const focusTarget = returnFocusEl;
    selectedElement = null;
    returnFocusEl = null;

    queueMicrotask(() => {
      focusTarget?.focus();
    });
  }

  function closeModalIfOpen(): boolean {
    if (selectedElement === null) {
      returnFocusEl = null;
      return false;
    }

    closeModal();
    return true;
  }

  function updateSearchUrl(filters: ElementSearchFilterState): void {
    const searchParams = toElementSearchParams(filters);
    const query = searchParams.toString();
    const nextUrl = query === '' ? page.url.pathname : `${page.url.pathname}?${query}`;

    void goto(nextUrl, {
      replaceState: true,
      noScroll: true,
      keepFocus: true
    });
  }

  function applyFilters(filters: ElementSearchFilterState): void {
    closeModalIfOpen();
    updateSearchUrl(filters);
  }

  function resetFilters(): void {
    applyFilters(DEFAULT_ELEMENT_SEARCH_FILTERS);
  }
</script>

<div class="space-y-6">
  <section>
    <h1 class="text-text text-2xl font-bold">元素一覧</h1>
    <p class="text-text-muted mt-2 text-sm">118種類の元素を分類ごとに色分けして表示します。</p>
  </section>

  {#if isInitialLoading}
    <section class="border-border-muted bg-surface rounded border p-6">
      <p class="text-text-muted text-sm">元素一覧を読み込み中です...</p>
    </section>
  {:else if errorMessage}
    <section class="border-danger-border bg-danger-surface rounded border p-6">
      <p class="text-danger-text text-sm">{errorMessage}</p>
      <button
        type="button"
        onclick={() => loadElements({ showToast: true })}
        class="bg-action text-text-inverse hover:bg-action-hover focus:ring-focus mt-4 rounded-md px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none"
      >
        再読み込み
      </button>
    </section>
  {:else if isEmpty}
    <section class="border-border-muted bg-surface rounded border p-6">
      <p class="text-text-muted text-sm">該当する元素がありません。</p>
    </section>
  {:else}
    <section class="space-y-3" aria-busy={isSearching ? 'true' : undefined}>
      <ElementSearchFilters
        filters={appliedFilters}
        resultCount={elements.length}
        {isSearching}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      {#if isUpdatingWithoutResults}
        <section class="border-border-muted bg-surface rounded border p-6" aria-busy="true">
          <p class="text-text-muted text-sm">検索結果を読み込み中です...</p>
        </section>
      {:else if isSearchEmpty}
        <section class="border-border-muted bg-surface rounded border p-6">
          <p class="text-text text-sm">条件に一致する元素がありません。</p>
          <p class="text-text-subtle mt-1 text-sm">
            キーワードやフィルター条件を変更してください。
          </p>
          <button
            type="button"
            onclick={resetFilters}
            class="border-border text-text hover:bg-surface-subtle focus:ring-focus mt-4 rounded-md border px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none"
          >
            条件をリセット
          </button>
        </section>
      {:else}
        <ul role="list" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {#each elements as element (element.id)}
            {@const style = getElementCategoryStyle(element.category)}
            <li>
              <button
                type="button"
                class={`hover:ring-focus focus-visible:ring-focus w-full rounded border p-3 text-left transition-shadow hover:ring-2 focus:outline-none focus-visible:ring-2 ${style.cardClass}`}
                aria-label={getElementCardAriaLabel(element)}
                onclick={(event) => openModal(element, event)}
              >
                <p class="text-text-subtle text-base font-semibold">{element.id}</p>
                <p class="text-text mt-2 text-2xl font-bold">{element.symbol}</p>
                <p class="text-text mt-1 text-sm font-medium">{element.nameJa}</p>
                <p
                  class={`mt-3 inline-block rounded px-2 py-1 text-xs font-semibold ${style.badgeClass}`}
                >
                  {element.category}
                </p>
                {#if authStore.isLoggedIn && element.masteryStatus}
                  <span class="mt-2 block">
                    <ElementMasteryBadge status={element.masteryStatus} ariaHidden={true} />
                  </span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>

        <ElementDetailModal element={selectedElement} onClose={closeModal} />
      {/if}
    </section>
  {/if}
</div>
