<script lang="ts">
  import type { MyAccuracyTrendItem } from '$lib/api/users';
  import { formatAccuracyRate, formatStatsDate, toAccuracyChartValues } from '$lib/mypage/stats';

  type Props = {
    items: readonly MyAccuracyTrendItem[];
  };

  let { items }: Props = $props();

  const chartWidth = 640;
  const chartHeight = 220;
  const chartPadding = 28;
  const chartInnerWidth = chartWidth - chartPadding * 2;
  const chartInnerHeight = chartHeight - chartPadding * 2;

  const chartValues = $derived(toAccuracyChartValues(items));
  const hasTrend = $derived(items.length > 0);
  const points = $derived(
    chartValues.map((value, index) => {
      const x =
        items.length === 1
          ? chartPadding + chartInnerWidth / 2
          : chartPadding + (chartInnerWidth * index) / (items.length - 1);
      const y = chartPadding + chartInnerHeight - (chartInnerHeight * value) / 100;
      return { x, y, value, item: items[index] };
    })
  );
  const polylinePoints = $derived(points.map((point) => point.x + ',' + point.y).join(' '));
  const latestItem = $derived(items.at(-1) ?? null);
</script>

<figure class="space-y-3">
  <figcaption class="text-sm text-gray-600">
    {#if latestItem}
      最新ゲームの正答率は{formatAccuracyRate(latestItem.accuracyRate)}です。
    {:else}
      まだグラフに表示できるゲーム履歴がありません。
    {/if}
  </figcaption>

  {#if hasTrend}
    <div class="overflow-x-auto rounded border border-gray-200 bg-white p-4 shadow-sm">
      <svg
        viewBox={'0 0 ' + chartWidth + ' ' + chartHeight}
        class="h-56 min-w-[520px] text-blue-600"
        role="img"
        aria-label={'直近' + items.length + 'ゲームの正答率推移'}
      >
        <line
          x1={chartPadding}
          y1={chartPadding}
          x2={chartPadding}
          y2={chartHeight - chartPadding}
          class="stroke-gray-300"
          stroke-width="1"
        />
        <line
          x1={chartPadding}
          y1={chartHeight - chartPadding}
          x2={chartWidth - chartPadding}
          y2={chartHeight - chartPadding}
          class="stroke-gray-300"
          stroke-width="1"
        />
        {#each [0, 50, 100] as tick (tick)}
          <line
            x1={chartPadding}
            y1={chartPadding + chartInnerHeight - (chartInnerHeight * tick) / 100}
            x2={chartWidth - chartPadding}
            y2={chartPadding + chartInnerHeight - (chartInnerHeight * tick) / 100}
            class="stroke-gray-100"
            stroke-width="1"
          />
          <text
            x={chartPadding - 8}
            y={chartPadding + chartInnerHeight - (chartInnerHeight * tick) / 100 + 4}
            text-anchor="end"
            class="fill-gray-500 text-[11px]"
          >
            {tick}%
          </text>
        {/each}
        <polyline
          points={polylinePoints}
          fill="none"
          class="stroke-blue-600"
          stroke-width="4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        {#each points as point (point.item.sessionId)}
          <circle
            cx={point.x}
            cy={point.y}
            r="5"
            class="fill-white stroke-blue-600"
            stroke-width="3"
          />
          <text x={point.x} y={point.y - 10} text-anchor="middle" class="fill-gray-700 text-[11px]">
            {point.value}%
          </text>
        {/each}
      </svg>
    </div>

    <ol class="grid gap-2 text-sm text-gray-600 sm:grid-cols-2" aria-label="正答率推移の詳細">
      {#each items as item, index (item.sessionId)}
        <li class="rounded border border-gray-200 bg-white px-3 py-2">
          <span class="font-semibold text-gray-900">{index + 1}回目</span>
          <span>
            {formatStatsDate(item.playedAt)} / {item.correctCount}/{item.totalCount}問 / {formatAccuracyRate(
              item.accuracyRate
            )}</span
          >
        </li>
      {/each}
    </ol>
  {:else}
    <div class="rounded border border-gray-200 bg-white p-5">
      <p class="text-sm text-gray-600">
        ゲームをプレイすると、直近10ゲームの正答率推移が表示されます。
      </p>
    </div>
  {/if}
</figure>
