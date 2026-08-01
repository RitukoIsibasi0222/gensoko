<script lang="ts">
  import { getElementMasteryBadgeView } from '$lib/elements/mastery-badge';
  import type { ElementMasteryStatus } from '$lib/elements/types';

  type Props = {
    status: ElementMasteryStatus;
    ariaHidden?: boolean;
  };

  let { status, ariaHidden = false }: Props = $props();

  const view = $derived(getElementMasteryBadgeView(status));
</script>

<span
  class={`inline-flex items-center rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ${view.className}`}
  aria-label={ariaHidden ? undefined : view.ariaLabel}
  aria-hidden={ariaHidden ? 'true' : undefined}
>
  {view.label}
</span>
