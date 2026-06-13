<script lang="ts">
  import { getTimerPercent } from '$lib/game/play';

  type Props = {
    remainingSec: number;
    timeLimitSec: number;
  };

  let { remainingSec, timeLimitSec }: Props = $props();

  const timerPercent = $derived(getTimerPercent(remainingSec, timeLimitSec));
  const isLowTime = $derived(remainingSec <= 5);
  const barClass = $derived(isLowTime ? 'bg-red-500' : 'bg-brand');
</script>

<div class="space-y-2" aria-label="残り時間">
  <div class="flex items-center justify-between gap-3">
    <p class="text-sm font-semibold text-gray-700">残り時間</p>
    <p class={`text-sm font-bold ${isLowTime ? 'text-red-700' : 'text-gray-700'}`}>
      {remainingSec}秒
    </p>
  </div>

  <div
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax={timeLimitSec}
    aria-valuenow={remainingSec}
    aria-label={`残り${remainingSec}秒`}
    class="h-3 overflow-hidden rounded-full bg-gray-200"
  >
    <div
      class={`h-full rounded-full transition-all duration-300 ${barClass}`}
      style={`width: ${timerPercent}%`}
    ></div>
  </div>

  {#if isLowTime}
    <p class="text-xs font-semibold text-red-700">残り時間が少なくなっています。</p>
  {/if}
</div>
