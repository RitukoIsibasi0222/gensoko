import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_SESSION_HISTORY_LIMIT,
  formatGameSessionPlayedAt,
  getGameSessionAccuracy,
  normalizeGameSessionHistoryQuery
} from './session-history';

describe('normalizeGameSessionHistoryQuery', () => {
  it('空 query は既定値に正規化する', () => {
    expect(normalizeGameSessionHistoryQuery({})).toEqual({
      limit: DEFAULT_GAME_SESSION_HISTORY_LIMIT,
      cursor: null,
      mode: null
    });
  });

  it('limit, cursor, mode を一度正規化した値として返す', () => {
    expect(
      normalizeGameSessionHistoryQuery({
        limit: '10',
        cursor: '  session-1  ',
        mode: 'NAME_TO_SYMBOL_LV1'
      })
    ).toEqual({
      limit: 10,
      cursor: 'session-1',
      mode: 'NAME_TO_SYMBOL_LV1'
    });
  });

  it('不正な limit は既定値にし、不正 mode と空 cursor は null にする', () => {
    expect(
      normalizeGameSessionHistoryQuery({
        limit: '10.5',
        cursor: '   ',
        mode: 'UNKNOWN'
      })
    ).toEqual({
      limit: DEFAULT_GAME_SESSION_HISTORY_LIMIT,
      cursor: null,
      mode: null
    });
  });
});

describe('game session history display helpers', () => {
  it('正答率を整数パーセントで返す', () => {
    expect(getGameSessionAccuracy({ correctCount: 8, totalCount: 10 })).toBe(80);
  });

  it('totalCount が 0 の場合は正答率 0 を返す', () => {
    expect(getGameSessionAccuracy({ correctCount: 0, totalCount: 0 })).toBe(0);
  });

  it('有効な日時は ja-JP 表示にし、無効な日時は元文字列を返す', () => {
    expect(formatGameSessionPlayedAt('2026-06-20T12:35:00.000Z')).toContain('2026');
    expect(formatGameSessionPlayedAt('not-date')).toBe('not-date');
  });
});
