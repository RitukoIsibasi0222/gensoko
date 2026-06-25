import type { MyAccuracyTrendItem } from '$lib/api/users';

const statNumberFormatter = new Intl.NumberFormat('ja-JP');
const statsDateFormatter = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

export function formatStatNumber(value: number): string {
  return statNumberFormatter.format(value);
}

export function formatAccuracyRate(value: number): string {
  return statNumberFormatter.format(value) + '%';
}

export function formatStatsDate(value: string | null): string {
  if (value === null) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return statsDateFormatter.format(date);
}

export function toAccuracyChartLabels(items: readonly MyAccuracyTrendItem[]): string[] {
  return items.map((item) => formatStatsDate(item.playedAt));
}

export function toAccuracyChartValues(items: readonly MyAccuracyTrendItem[]): number[] {
  return items.map((item) => item.accuracyRate);
}
