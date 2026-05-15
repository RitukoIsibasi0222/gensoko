<script lang="ts">
  import { toastStore } from '$lib/stores/toast.svelte';
  import Toast from './Toast.svelte';

  // toastStore.toasts を reactive に読み取る
  const toasts = $derived(toastStore.toasts);
</script>

<!-- 画面右下にトーストをスタック表示するコンテナ -->
<div class="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-3">
  {#each toasts as toast (toast.id)}
    <!-- pointer-events-auto で Toast コンポーネント自体はクリック可能にする -->
    <div class="pointer-events-auto">
      <Toast {toast} />
    </div>
  {/each}
</div>
