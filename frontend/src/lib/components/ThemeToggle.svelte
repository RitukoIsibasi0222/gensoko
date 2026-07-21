<script lang="ts">
  import { themeStore } from '$lib/stores/theme.svelte';

  const actionLabel = $derived(
    themeStore.isDark ? 'ライトモードに切り替える' : 'ダークモードに切り替える'
  );
  const modeLabel = $derived(themeStore.isDark ? 'ライト' : 'ダーク');
</script>

<button
  type="button"
  class="border-border-strong bg-surface text-text hover:bg-surface-muted focus-visible:outline-focus inline-flex min-h-10 items-center justify-center gap-2 rounded border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
  aria-label={actionLabel}
  aria-pressed={themeStore.isDark}
  onclick={() => themeStore.toggle()}
>
  <span aria-hidden="true">{themeStore.isDark ? '☀' : '☾'}</span>
  <span>{modeLabel}</span>
</button>
