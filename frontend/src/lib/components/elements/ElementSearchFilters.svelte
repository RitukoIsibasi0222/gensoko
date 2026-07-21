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
  const selectedCategoryIsUnknown = $derived(
    filters.category !== '' && !categoryOptions.includes(filters.category)
  );

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

<section class="border-border-muted bg-surface rounded border p-4">
  <form class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_13rem_11rem_auto]" onsubmit={handleSubmit}>
    <div>
      <label for="element-keyword" class="text-text block text-sm font-medium"> キーワード </label>
      <input
        id="element-keyword"
        type="search"
        bind:value={draftKeyword}
        {disabled}
        placeholder="番号・記号・名前"
        onkeydown={handleKeywordKeydown}
        class="border-border focus:border-focus focus:ring-focus disabled:bg-surface-subtle disabled:text-text-subtle mt-1 w-full rounded-md border px-3 py-2 focus:ring-1 focus:outline-none disabled:cursor-not-allowed"
      />
    </div>

    <div>
      <label for="element-category" class="text-text block text-sm font-medium"> 分類 </label>
      <select
        id="element-category"
        value={filters.category}
        {disabled}
        onchange={handleCategoryChange}
        class="border-border bg-surface focus:border-focus focus:ring-focus disabled:bg-surface-subtle disabled:text-text-subtle mt-1 w-full rounded-md border px-3 py-2 focus:ring-1 focus:outline-none disabled:cursor-not-allowed"
      >
        <option value="">すべての分類</option>
        {#if selectedCategoryIsUnknown}
          <option value={filters.category}>現在の分類: {filters.category}</option>
        {/if}
        {#each categoryOptions as category}
          <option value={category}>{category}</option>
        {/each}
      </select>
    </div>

    <div>
      <label for="element-period" class="text-text block text-sm font-medium"> 周期 </label>
      <select
        id="element-period"
        value={filters.period === null ? '' : String(filters.period)}
        {disabled}
        onchange={handlePeriodChange}
        class="border-border bg-surface focus:border-focus focus:ring-focus disabled:bg-surface-subtle disabled:text-text-subtle mt-1 w-full rounded-md border px-3 py-2 focus:ring-1 focus:outline-none disabled:cursor-not-allowed"
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
        class="bg-action text-text-inverse hover:bg-action-hover focus:ring-focus rounded-md px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        検索
      </button>
      <button
        type="button"
        {disabled}
        onclick={handleReset}
        class="border-border text-text hover:bg-surface-subtle focus:ring-focus rounded-md border px-4 py-2 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        リセット
      </button>
    </div>
  </form>

  <p class="text-text-muted mt-3 text-sm" aria-live="polite">
    {#if isSearching}
      検索結果を更新しています。現在{resultCount}件を表示しています。
    {:else if totalCount === undefined}
      {resultCount}件を表示しています。
    {:else}
      全{totalCount}件中 {resultCount}件を表示しています。
    {/if}
  </p>
</section>
