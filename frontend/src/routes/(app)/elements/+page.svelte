<script lang="ts">
  import { onMount } from 'svelte';
  import ElementDetailModal from '$lib/components/elements/ElementDetailModal.svelte';
  import { getElements } from '$lib/api/elements';
  import { ApiError } from '$lib/api/errors';
  import { getElementCategoryStyle } from '$lib/elements/category-style';
  import type { Element } from '$lib/elements/types';
  import { toastStore } from '$lib/stores/toast.svelte';

  const NETWORK_ERROR_MESSAGE = 'ネットワークエラーが発生しました。接続を確認してください';

  let elements = $state<Element[]>([]);
  let isLoading = $state(true);
  let isRequesting = false;
  let errorMessage = $state<string | null>(null);
  let selectedElement = $state<Element | null>(null);
  let returnFocusEl: HTMLElement | null = null;
  let shouldRestoreFocus = false;

  const isEmpty = $derived(!isLoading && errorMessage === null && elements.length === 0);

  async function loadElements(showToast = false): Promise<void> {
    if (isRequesting) {
      return;
    }

    isRequesting = true;
    isLoading = true;
    errorMessage = null;

    try {
      elements = await getElements();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : NETWORK_ERROR_MESSAGE;
      errorMessage = message;
      elements = [];

      if (showToast) {
        toastStore.error(message);
      }
    } finally {
      isLoading = false;
      isRequesting = false;
    }
  }

  function openModal(element: Element, event: MouseEvent): void {
    const currentTarget = event.currentTarget;
    if (currentTarget instanceof HTMLElement) {
      returnFocusEl = currentTarget;
    }

    // click.detail === 0 はキーボード起点（Enter/Space）
    shouldRestoreFocus = event.detail === 0;

    selectedElement = element;
  }

  function closeModal(): void {
    const focusTarget = shouldRestoreFocus ? returnFocusEl : null;
    selectedElement = null;

    queueMicrotask(() => {
      focusTarget?.focus();
    });

    shouldRestoreFocus = false;
    returnFocusEl = null;
  }

  onMount(() => {
    void loadElements();
  });
</script>

<div class="space-y-6">
  <section>
    <h1 class="text-2xl font-bold text-gray-800">元素一覧</h1>
    <p class="mt-2 text-sm text-gray-600">118種類の元素を分類ごとに色分けして表示します。</p>
  </section>

  {#if isLoading}
    <section class="rounded border border-gray-200 bg-white p-6">
      <p class="text-sm text-gray-600">元素一覧を読み込み中です...</p>
    </section>
  {:else if errorMessage}
    <section class="rounded border border-red-200 bg-red-50 p-6">
      <p class="text-sm text-red-700">{errorMessage}</p>
      <button
        type="button"
        onclick={() => loadElements(true)}
        class="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
      >
        再読み込み
      </button>
    </section>
  {:else if isEmpty}
    <section class="rounded border border-gray-200 bg-white p-6">
      <p class="text-sm text-gray-600">該当する元素がありません。</p>
    </section>
  {:else}
    <section class="space-y-3">
      <p class="text-sm text-gray-600">全{elements.length}件の元素を表示しています。</p>
      <ul role="list" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {#each elements as element (element.id)}
          {@const style = getElementCategoryStyle(element.category)}
          <li>
            <button
              type="button"
              class={`w-full rounded border p-3 text-left transition-shadow hover:ring-2 hover:ring-[#2f7d57] focus:ring-2 focus:ring-[#2f7d57] focus:outline-none ${style.cardClass}`}
              aria-label={`${element.id}番 ${element.symbol} ${element.nameJa} の詳細を開く`}
              onclick={(event) => openModal(element, event)}
            >
              <p class="text-base font-semibold text-gray-500">{element.id}</p>
              <p class="mt-2 text-2xl font-bold text-gray-900">{element.symbol}</p>
              <p class="mt-1 text-sm font-medium text-gray-700">{element.nameJa}</p>
              <p
                class={`mt-3 inline-block rounded px-2 py-1 text-xs font-semibold ${style.badgeClass}`}
              >
                {element.category}
              </p>
            </button>
          </li>
        {/each}
      </ul>

      <ElementDetailModal element={selectedElement} onClose={closeModal} />
    </section>
  {/if}
</div>
