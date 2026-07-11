<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    open: boolean;
    title: string;
    description?: string;
    isBusy?: boolean;
    initialFocus?: 'close' | 'cancel';
    returnFocus?: HTMLElement | null;
    fallbackFocus?: HTMLElement | null;
    onClose: () => void;
    children?: Snippet;
  };
  let {
    open,
    title,
    description,
    isBusy = false,
    initialFocus = 'close',
    returnFocus = null,
    fallbackFocus = null,
    onClose,
    children
  }: Props = $props();

  let dialogElement = $state<HTMLElement>();
  let closeButton = $state<HTMLButtonElement>();
  let previousBodyOverflow = '';
  let isScrollLocked = false;
  let wasOpen = false;

  function lockBodyScroll(): void {
    if (isScrollLocked) {
      return;
    }
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    isScrollLocked = true;
  }

  function unlockBodyScroll(): void {
    if (!isScrollLocked) {
      return;
    }
    document.body.style.overflow = previousBodyOverflow;
    isScrollLocked = false;
  }

  function getFocusableElements(): HTMLElement[] {
    if (!dialogElement) {
      return [];
    }

    return Array.from(
      dialogElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    );
  }

  function focusAfterClose(): void {
    if (returnFocus?.isConnected) {
      returnFocus.focus();
      return;
    }
    if (fallbackFocus?.isConnected) {
      fallbackFocus.focus();
    }
  }

  function requestClose(): void {
    if (isBusy) {
      return;
    }
    focusAfterClose();
    onClose();
  }

  function manageScrollLock(element: HTMLElement): { destroy: () => void } {
    void element;
    lockBodyScroll();
    return { destroy: unlockBodyScroll };
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusableElements = getFocusableElements();
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialogElement?.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  $effect(() => {
    if (open) {
      wasOpen = true;
      queueMicrotask(() => {
        const cancelButton =
          initialFocus === 'cancel'
            ? dialogElement?.querySelector<HTMLElement>('[data-cancel]')
            : null;
        (cancelButton ?? closeButton)?.focus();
      });
    } else if (wasOpen) {
      wasOpen = false;
      queueMicrotask(focusAfterClose);
    }
  });
</script>

{#if open}
  <div use:manageScrollLock class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <button
      data-dialog-backdrop
      type="button"
      tabindex="-1"
      aria-label="&#x30C0;&#x30A4;&#x30A2;&#x30ED;&#x30B0;&#x3092;&#x9589;&#x3058;&#x308B;"
      disabled={isBusy}
      class="absolute inset-0 bg-black/50"
      onclick={requestClose}
    ></button>
    <div
      bind:this={dialogElement}
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-dialog-title"
      aria-describedby={description ? 'admin-dialog-description' : undefined}
      aria-busy={isBusy}
      tabindex="-1"
      class="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl"
      onkeydown={handleDialogKeydown}
    >
      <div class="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
        <div>
          <h2 id="admin-dialog-title" class="text-ink text-xl font-bold">{title}</h2>
          {#if description}
            <p id="admin-dialog-description" class="mt-1 text-sm text-gray-600">{description}</p>
          {/if}
        </div>
        <button
          bind:this={closeButton}
          data-dialog-close
          type="button"
          aria-label="ダイアログを閉じる"
          disabled={isBusy}
          class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:text-gray-400"
          onclick={requestClose}
        >
          閉じる
        </button>
      </div>

      <div class="p-5">
        {#if children}
          {@render children()}
        {/if}
      </div>
    </div>
  </div>
{/if}
