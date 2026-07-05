import { describe, expect, it } from 'vitest';
import type { RankingEntry } from '$lib/api/ranking';
import {
  getPrimaryCta,
  getSecondaryCta,
  getTopPageAudience,
  selectRankingPreviewEntries,
  toHomeRankingPreviewEntries,
  type HomeRankingPreviewEntry
} from './content';

describe('getTopPageAudience', () => {
  it('初期化中はログイン状態に関係なく initializing', () => {
    expect(getTopPageAudience(true, true)).toBe('initializing');
    expect(getTopPageAudience(true, false)).toBe('initializing');
  });

  it('初期化完了かつログイン済みなら authenticated', () => {
    expect(getTopPageAudience(false, true)).toBe('authenticated');
  });

  it('初期化完了かつ未ログインなら anonymous', () => {
    expect(getTopPageAudience(false, false)).toBe('anonymous');
  });
});

describe('getPrimaryCta', () => {
  it('initializing は非活性CTA', () => {
    expect(getPrimaryCta('initializing')).toEqual({
      href: '#',
      label: '準備中...',
      description: '認証状態を確認しています。',
      disabled: true
    });
  });

  it('authenticated は /game を返す', () => {
    const cta = getPrimaryCta('authenticated');
    expect(cta.href).toBe('/game');
    expect(cta.disabled).toBe(false);
  });

  it('anonymous は /register を返す', () => {
    const cta = getPrimaryCta('anonymous');
    expect(cta.href).toBe('/register');
    expect(cta.disabled).toBe(false);
  });
});

describe('getSecondaryCta', () => {
  it('全audienceで /elements を返す', () => {
    expect(getSecondaryCta('initializing').href).toBe('/elements');
    expect(getSecondaryCta('authenticated').href).toBe('/elements');
    expect(getSecondaryCta('anonymous').href).toBe('/elements');
  });
});

describe('selectRankingPreviewEntries', () => {
  const entries: HomeRankingPreviewEntry[] = [
    { rank: 1, username: 'u1', weeklyScore: 1000, totalGames: 10 },
    { rank: 2, username: 'u2', weeklyScore: 900, totalGames: 9 },
    { rank: 3, username: 'u3', weeklyScore: 800, totalGames: 8 },
    { rank: 4, username: 'u4', weeklyScore: 700, totalGames: 7 },
    { rank: 5, username: 'u5', weeklyScore: 600, totalGames: 6 }
  ];

  it('空配列は空のまま返す', () => {
    expect(selectRankingPreviewEntries([], 3)).toEqual([]);
  });

  it('上限以下の件数はそのまま返す', () => {
    const shortEntries = entries.slice(0, 2);
    expect(selectRankingPreviewEntries(shortEntries, 3)).toEqual(shortEntries);
  });

  it('上限超過は先頭からlimit件だけ返す', () => {
    expect(selectRankingPreviewEntries(entries, 3)).toEqual(entries.slice(0, 3));
  });

  it('元配列は破壊しない', () => {
    const before = [...entries];
    selectRankingPreviewEntries(entries, 3);
    expect(entries).toEqual(before);
  });
});

describe('toHomeRankingPreviewEntries', () => {
  const rankingEntries: RankingEntry[] = [
    { rank: 1, username: 'taro', score: 15000, totalGames: 30, accuracyRate: 86 },
    { rank: 2, username: 'hanako', score: 9200, totalGames: 18, accuracyRate: 91 }
  ];

  it('空配列は空のまま返す', () => {
    expect(toHomeRankingPreviewEntries([])).toEqual([]);
  });

  it('RankingEntry の score を HomeRankingPreviewEntry の weeklyScore に変換する', () => {
    expect(toHomeRankingPreviewEntries(rankingEntries)).toEqual([
      { rank: 1, username: 'taro', weeklyScore: 15000, totalGames: 30 },
      { rank: 2, username: 'hanako', weeklyScore: 9200, totalGames: 18 }
    ]);
  });

  it('元配列は破壊しない', () => {
    const before = structuredClone(rankingEntries);

    toHomeRankingPreviewEntries(rankingEntries);

    expect(rankingEntries).toEqual(before);
  });
});
