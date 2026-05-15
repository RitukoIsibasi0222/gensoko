<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import type { Toast } from '$lib/stores/toast.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';

  type Props = {
    toast: Toast;
  };

  let { toast }: Props = $props();

  // variant に応じた aria 属性を決定
  const isUrgent = $derived(toast.variant === 'error' || toast.variant === 'warning');
  const role = $derived(isUrgent ? 'alert' : 'status');
  const ariaLive = $derived(isUrgent ? 'assertive' : 'polite');

  // variant に応じたスタイルとアイコンを決定
  const variantStyles = {
    success: 'bg-green-50 border-green-500 text-green-900',
    error: 'bg-red-50 border-red-500 text-red-900',
    info: 'bg-blue-50 border-blue-500 text-blue-900',
    warning: 'bg-yellow-50 border-yellow-500 text-yellow-900'
  };

  const variantIcons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
  };

  const styleClass = $derived(variantStyles[toast.variant]);
  const icon = $derived(variantIcons[toast.variant]);

  function handleDismiss() {
    toastStore.dismiss(toast.id);
  }
</script>

<div
  {role}
  aria-live={ariaLive}
  in:fly={{ x: 20, duration: 200 }}
  out:fade={{ duration: 150 }}
  class="flex items-start gap-3 rounded-lg border-l-4 px-4 py-3 shadow-lg {styleClass}"
>
  <!-- アイコン -->
  <span class="text-xl font-bold" aria-hidden="true">{icon}</span>

  <!-- メッセージ本文 -->
  <p class="flex-1 text-sm font-medium">{toast.message}</p>

  <!-- 閉じるボタン -->
  <button
    type="button"
    onclick={handleDismiss}
    class="text-current opacity-70 transition-opacity hover:opacity-100"
    aria-label="閉じる"
  >
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path
        fill-rule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clip-rule="evenodd"
      />
    </svg>
  </button>
</div>
