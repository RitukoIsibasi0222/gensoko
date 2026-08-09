<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();
</script>

<div class="flex min-h-screen items-center justify-center px-4 py-8" data-auth-layout>
  <div
    class="border-border-panel bg-surface w-full max-w-md rounded border p-6"
    data-auth-panel
  >
    {@render children()}
  </div>
</div>
