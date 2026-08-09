<script lang="ts">
  import type { HTMLAnchorAttributes } from 'svelte/elements';

  type Props = {
    accessibleLabel?: string;
    onclick?: HTMLAnchorAttributes['onclick'];
  };

  let { accessibleLabel, onclick }: Props = $props();
</script>

<a
  href="/"
  aria-label={accessibleLabel}
  class="text-brand inline-flex items-center gap-2 text-xl font-bold"
  {onclick}
>
  <img src="/logo.png" alt="" width="262" height="235" class="h-auto w-[30px] shrink-0" />
  <span>Gensoko</span>
</a>
