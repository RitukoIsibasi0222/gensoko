import type { RankingPeriod } from '$lib/api/ranking';

const rankingNumberFormatter = new Intl.NumberFormat('ja-JP');

export function normalizeRankingPeriod(value: string | null): RankingPeriod {
  return value === 'alltime' ? 'alltime' : 'weekly';
}

export function toRankingSearchParams(period: RankingPeriod): URLSearchParams {
  return new URLSearchParams({ period });
}

export function isRankingPeriodActivationKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}

export function formatRankingScore(value: number): string {
  return rankingNumberFormatter.format(value) + ' pt';
}

export function formatRankingAccuracy(value: number): string {
  return rankingNumberFormatter.format(value) + '%';
}
