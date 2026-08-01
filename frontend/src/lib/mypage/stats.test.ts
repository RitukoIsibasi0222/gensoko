import { describe, expect, it } from 'vitest';
import {
  formatAccuracyRate,
  formatStatNumber,
  formatStatsDate,
  toAccuracyChartLabels,
  toAccuracyChartValues
} from './stats';

const TREND_ITEMS = [
  {
    sessionId: 'session-1',
    playedAt: '2026-06-19T12:35:00.000Z',
    correctCount: 5,
    totalCount: 10,
    accuracyRate: 50
  },
  {
    sessionId: 'session-2',
    playedAt: '2026-06-20T12:35:00.000Z',
    correctCount: 8,
    totalCount: 10,
    accuracyRate: 80
  }
];

describe('mypage stats display helpers', () => {
  it('数値を ja-JP locale で整形する', () => {
    expect(formatStatNumber(1234567)).toBe('1,234,567');
  });

  it('正答率をパーセント表示にする', () => {
    expect(formatAccuracyRate(76)).toBe('76%');
  });

  it('null 日付はハイフンにし、有効な日時は ja-JP 表示にする', () => {
    expect(formatStatsDate(null)).toBe('-');
    expect(formatStatsDate('2026-06-20T12:35:00.000Z')).toContain('2026');
  });

  it('不正な日付文字列は元文字列を返す', () => {
    expect(formatStatsDate('not-date')).toBe('not-date');
  });

  it('グラフラベルはプレイ日時から作る', () => {
    expect(toAccuracyChartLabels(TREND_ITEMS)).toEqual([
      expect.stringContaining('2026'),
      expect.stringContaining('2026')
    ]);
  });

  it('グラフ値は正答率配列として返す', () => {
    expect(toAccuracyChartValues(TREND_ITEMS)).toEqual([50, 80]);
  });

  it('空の推移は空配列にする', () => {
    expect(toAccuracyChartLabels([])).toEqual([]);
    expect(toAccuracyChartValues([])).toEqual([]);
  });
});
