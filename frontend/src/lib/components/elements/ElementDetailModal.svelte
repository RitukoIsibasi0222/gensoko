<script lang="ts">
  import { buildElementDetailFields } from '$lib/elements/detail-fields';
  import { getElementCategoryStyle } from '$lib/elements/category-style';
  import type { Element } from '$lib/elements/types';

  type Props = {
    element: Element | null;
    onClose: () => void;
  };

  let { element, onClose }: Props = $props();
  let closeButtonEl = $state<HTMLButtonElement | null>(null);
  let dialogEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (element === null) {
      return;
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      if (dialogEl === null) {
        return;
      }

      const focusableSelector =
        'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusableElements = Array.from(
        dialogEl.querySelectorAll<HTMLElement>(focusableSelector)
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogEl.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (!(activeElement instanceof HTMLElement) || !dialogEl.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus();
        return;
      }

      if (event.shiftKey && activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', handleKeydown);

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    if (scrollbarWidth > 0) {
      const computedPaddingRight = window.getComputedStyle(document.body).paddingRight;
      const currentPaddingRight = Number.parseFloat(computedPaddingRight) || 0;
      document.body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
    }

    document.body.style.overflow = 'hidden';

    queueMicrotask(() => {
      closeButtonEl?.focus();
    });

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  });
</script>

{#if element}
  {@const titleId = `element-detail-modal-title-${element.id}`}
  {@const descId = `element-detail-modal-description-${element.id}`}
  {@const style = getElementCategoryStyle(element.category)}
  {@const fields = buildElementDetailFields(element)}

  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      type="button"
      tabindex="-1"
      class="absolute inset-0 cursor-default bg-black/50 focus:outline-none"
      onclick={onClose}
      aria-label="背景をクリックして閉じる"
    ></button>

    <div
      bind:this={dialogEl}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabindex="-1"
      class="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded border border-gray-200 bg-white p-6 shadow-xl"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-base font-semibold text-gray-500">{element.id}</p>
          <h2 id={titleId} class="mt-1 text-2xl font-bold text-gray-900">
            {element.symbol}
            {element.nameJa}
          </h2>
          <p class="mt-1 text-base text-gray-600">{element.nameEn}</p>
        </div>

        <button
          type="button"
          bind:this={closeButtonEl}
          onclick={onClose}
          class="rounded border border-gray-300 px-3 py-1.5 text-base text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="閉じる"
        >
          閉じる
        </button>
      </div>

      <p id={descId} class="sr-only">選択した元素の詳細情報を表示しています。</p>

      <p class={`mt-4 inline-block rounded px-2 py-1 text-base font-semibold ${style.badgeClass}`}>
        {element.category}
      </p>

      <dl class="mt-5 space-y-3">
        {#each fields as field (field.key)}
          <div class="grid grid-cols-[5rem_1fr] items-start gap-2">
            <dt class="text-base font-medium text-gray-500">{field.label}</dt>
            <dd class="text-base break-words text-gray-800">{field.value}</dd>
          </div>
        {/each}
      </dl>
    </div>
  </div>
{/if}
