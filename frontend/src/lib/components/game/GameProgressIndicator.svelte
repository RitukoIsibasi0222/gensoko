<script lang="ts">
  import { getProgressLabel } from '$lib/game/play';

  type Props = {
    currentIndex: number;
    totalCount: number;
    answeredCount: number;
  };

  let { currentIndex, totalCount, answeredCount }: Props = $props();

  const progressLabel = $derived(getProgressLabel(currentIndex, totalCount));
  const items = $derived(
    Array.from({ length: totalCount }, (_, index) => ({
      index,
      label: `${index + 1}問目`,
      isAnswered: index < answeredCount,
      isCurrent: index === currentIndex
    }))
  );
</script>

<div class="space-y-3" aria-label="ゲーム進捗">
  <div class="flex items-center justify-between gap-3">
    <p class="text-sm font-semibold text-gray-700">進捗</p>
    <p class="text-sm text-gray-600">{progressLabel}</p>
  </div>

  <ol
    class="grid gap-1.5"
    style={`grid-template-columns: repeat(${Math.max(totalCount, 1)}, minmax(0, 1fr))`}
    aria-label={progressLabel}
  >
    {#each items as item (item.index)}
      <li>
        <span
          class={`block h-2.5 rounded-full ${
            item.isCurrent ? 'bg-brand' : item.isAnswered ? 'bg-emerald-500' : 'bg-gray-200'
          }`}
          title={item.label}
          aria-label={`${item.label}${item.isCurrent ? '、現在の問題' : item.isAnswered ? '、回答済み' : '、未回答'}`}
        ></span>
      </li>
    {/each}
  </ol>
</div>
