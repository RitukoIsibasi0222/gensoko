<script lang="ts">
  import {
    ELEMENT_PERIOD_OPTIONS,
    getElementCategoryOptions,
    normalizeElementSearchFilters
  } from '$lib/elements/search-filter';
  import type {
    ElementSearchFilterApplyHandler,
    ElementSearchFilters
  } from '$lib/elements/search-filter';

  type Props = {
    filters: ElementSearchFilters;
    resultCount: number;
    totalCount?: number;
    isSearching?: boolean;
    disabled?: boolean;
    onApply: ElementSearchFilterApplyHandler;
    onReset(): void;
  };

  let {
    filters,
    resultCount,
    totalCount,
    isSearching = false,
    disabled = false,
    onApply,
    onReset
  }: Props = $props();
  let draftKeyword = $state('');

  const categoryOptions = getElementCategoryOptions();

  $effect(() => {
    draftKeyword = filters.q;
  });

  function applyCurrentFilters(): void {
    if (disabled) {
      return;
    }

    const nextFilters = normalizeElementSearchFilters({
      q: draftKeyword,
      category: filters.category,
      period: filters.period
    });

    onApply(nextFilters);
  }

  function handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    applyCurrentFilters();
  }

  function handleKeywordKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) {
      return;
    }

    event.preventDefault();
    applyCurrentFilters();
  }

  function handleCategoryChange(event: Event): void {
    if (disabled) {
      return;
    }

    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const nextFilters = normalizeElementSearchFilters({
      q: draftKeyword,
      category: target.value,
      period: filters.period
    });

    onApply(nextFilters);
  }

  function handlePeriodChange(event: Event): void {
    if (disabled) {
      return;
    }

    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const nextFilters = normalizeElementSearchFilters({
      q: draftKeyword,
      category: filters.category,
      period: target.value
    });

    onApply(nextFilters);
  }

  function handleReset(): void {
    if (disabled) {
      return;
    }

    draftKeyword = '';
    onReset();
  }
</script>

<section class="rounded border border-gray-200 bg-white p-4">
  <form class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_13rem_11rem_auto]" onsubmit={handleSubmit}>
    <div>
      <label for="element-keyword" class="block text-sm font-medium text-gray-700">
        キーワード
      </label>
      <input
        id="element-keyword"
        type="search"
        bind:value={draftKeyword}
        {disabled}
        placeholder="番号・記号・名前"
        onkeydown={handleKeywordKeydown}
        class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
      />
    </div>

    <div>
      <label for="element-category" class="block text-sm font-medium text-gray-700"> 分類 </label>
      <select
        id="element-category"
        value={filters.category}
        {disabled}
        onchange={handleCategoryChange}
        class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
      >
        <option value="">すべての分類</option>
        {#each categoryOptions as category}
          <option value={category}>{category}</option>
        {/each}
      </select>
    </div>

    <div>
      <label for="element-period" class="block text-sm font-medium text-gray-700"> 周期 </label>
      <select
        id="element-period"
        value={filters.period === null ? '' : String(filters.period)}
        {disabled}
        onchange={handlePeriodChange}
        class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
      >
        <option value="">すべての周期</option>
        {#each ELEMENT_PERIOD_OPTIONS as period}
          <option value={String(period)}>{period}周期</option>
        {/each}
      </select>
    </div>

    <div class="flex items-end gap-2">
      <button
        type="submit"
        {disabled}
        class="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        検索
      </button>
      <button
        type="button"
        {disabled}
        onclick={handleReset}
        class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        リセット
      </button>
    </div>
  </form>

  <p class="mt-3 text-sm text-gray-600" aria-live="polite">
    {#if isSearching}
      検索結果を更新しています。現在{resultCount}件を表示しています。
    {:else if totalCount === undefined}
      {resultCount}件を表示しています。
    {:else}
      全{totalCount}件中 {resultCount}件を表示しています。
    {/if}
  </p>
</section>
