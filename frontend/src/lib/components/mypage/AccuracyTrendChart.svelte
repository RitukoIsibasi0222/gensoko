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
  const chartIdPrefix = $props.id();
  const chartTitleId = chartIdPrefix + '-accuracy-trend-title';
  const chartDescriptionId = chartIdPrefix + '-accuracy-trend-description';
  const chartTitle = $derived('直近' + items.length + 'ゲームの正答率推移');
  const chartDescription = $derived(
    latestItem
      ? '最新ゲームの正答率は' + formatAccuracyRate(latestItem.accuracyRate) + 'です。'
      : '正答率推移のグラフです。'
  );
</script>

<figure class="space-y-3">
  <figcaption class="text-text-muted text-sm">
    {#if latestItem}
      最新ゲームの正答率は{formatAccuracyRate(latestItem.accuracyRate)}です。
    {:else}
      まだグラフに表示できるゲーム履歴がありません。
    {/if}
  </figcaption>

  {#if hasTrend}
    <div class="border-border-muted bg-surface overflow-x-auto rounded border p-4 shadow-sm">
      <svg
        viewBox={'0 0 ' + chartWidth + ' ' + chartHeight}
        class="text-action h-56 min-w-[520px]"
        role="img"
        aria-labelledby={chartTitleId + ' ' + chartDescriptionId}
      >
        <title id={chartTitleId}>{chartTitle}</title>
        <desc id={chartDescriptionId}>{chartDescription}</desc>
        <line
          x1={chartPadding}
          y1={chartPadding}
          x2={chartPadding}
          y2={chartHeight - chartPadding}
          class="stroke-chart-grid"
          stroke-width="1"
        />
        <line
          x1={chartPadding}
          y1={chartHeight - chartPadding}
          x2={chartWidth - chartPadding}
          y2={chartHeight - chartPadding}
          class="stroke-chart-grid"
          stroke-width="1"
        />
        {#each [0, 50, 100] as tick (tick)}
          <line
            x1={chartPadding}
            y1={chartPadding + chartInnerHeight - (chartInnerHeight * tick) / 100}
            x2={chartWidth - chartPadding}
            y2={chartPadding + chartInnerHeight - (chartInnerHeight * tick) / 100}
            class="stroke-chart-grid-muted"
            stroke-width="1"
          />
          <text
            x={chartPadding - 8}
            y={chartPadding + chartInnerHeight - (chartInnerHeight * tick) / 100 + 4}
            text-anchor="end"
            class="fill-chart-label text-[11px]"
          >
            {tick}%
          </text>
        {/each}
        <polyline
          points={polylinePoints}
          fill="none"
          class="stroke-chart-line"
          stroke-width="4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        {#each points as point (point.item.sessionId)}
          <circle
            cx={point.x}
            cy={point.y}
            r="5"
            class="fill-chart-point stroke-chart-line"
            stroke-width="3"
          />
          <text
            x={point.x}
            y={point.y - 10}
            text-anchor="middle"
            class="fill-chart-label text-[11px]"
          >
            {point.value}%
          </text>
        {/each}
      </svg>
    </div>

    <ol class="text-text-muted grid gap-2 text-sm sm:grid-cols-2" aria-label="正答率推移の詳細">
      {#each items as item, index (item.sessionId)}
        <li class="border-border-muted bg-surface rounded border px-3 py-2">
          <span class="text-text font-semibold">{index + 1}回目</span>
          <span>
            {formatStatsDate(item.playedAt)} / {item.correctCount}/{item.totalCount}問 / {formatAccuracyRate(
              item.accuracyRate
            )}</span
          >
        </li>
      {/each}
    </ol>
  {:else}
    <div class="border-border-muted bg-surface rounded border p-5">
      <p class="text-text-muted text-sm">
        ゲームをプレイすると、直近10ゲームの正答率推移が表示されます。
      </p>
    </div>
  {/if}
</figure>
