import { describe, expect, it } from 'vitest';
import {
  formatRankingAccuracy,
  formatRankingScore,
  normalizeRankingPeriod,
  toRankingSearchParams
} from './ranking';

describe('ranking helpers', () => {
  it('period query は weekly / alltime だけを許可し、それ以外は weekly にする', () => {
    expect(normalizeRankingPeriod(null)).toBe('weekly');
    expect(normalizeRankingPeriod('')).toBe('weekly');
    expect(normalizeRankingPeriod('weekly')).toBe('weekly');
    expect(normalizeRankingPeriod('alltime')).toBe('alltime');
    expect(normalizeRankingPeriod('daily')).toBe('weekly');
  });

  it('period を URLSearchParams に変換する', () => {
    expect(toRankingSearchParams('weekly').toString()).toBe('period=weekly');
    expect(toRankingSearchParams('alltime').toString()).toBe('period=alltime');
  });

  it('スコアを ja-JP の桁区切りと pt 付きで表示する', () => {
    expect(formatRankingScore(15000)).toBe('15,000 pt');
    expect(formatRankingScore(0)).toBe('0 pt');
  });

  it('正答率を % 付きで表示する', () => {
    expect(formatRankingAccuracy(86)).toBe('86%');
    expect(formatRankingAccuracy(0)).toBe('0%');
  });
});
