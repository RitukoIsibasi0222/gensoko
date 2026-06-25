import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEAK_SORT_STATE,
  readWeakSortState,
  sortWeakElements,
  toWeakSortSearchParams,
  type WeakSortState
} from './sort';

const WEAK_ELEMENTS = [
  {
    elementId: 26,
    symbol: 'Fe',
    nameJa: '鉄',
    missCount: 3,
    addedAt: '2026-05-01T00:00:00.000Z'
  },
  {
    elementId: 8,
    symbol: 'O',
    nameJa: '酸素',
    missCount: 1,
    addedAt: '2026-04-20T00:00:00.000Z'
  },
  {
    elementId: 6,
    symbol: 'C',
    nameJa: '炭素',
    missCount: 3,
    addedAt: '2026-06-01T00:00:00.000Z'
  }
];

describe('readWeakSortState', () => {
  it('query がない場合はデフォルトを返す', () => {
    expect(readWeakSortState(new URLSearchParams())).toEqual(DEFAULT_WEAK_SORT_STATE);
  });

  it('sort と order を URL query から復元する', () => {
    expect(readWeakSortState(new URLSearchParams('sort=addedAt&order=asc'))).toEqual({
      key: 'addedAt',
      order: 'asc'
    });
  });

  it('不正 query はデフォルトに fallback する', () => {
    expect(readWeakSortState(new URLSearchParams('sort=unknown&order=sideways'))).toEqual(
      DEFAULT_WEAK_SORT_STATE
    );
  });
});

describe('toWeakSortSearchParams', () => {
  it('デフォルト状態は空 query にする', () => {
    expect(toWeakSortSearchParams(DEFAULT_WEAK_SORT_STATE).toString()).toBe('');
  });

  it('デフォルト以外は sort と order を query にする', () => {
    const sortState: WeakSortState = { key: 'elementId', order: 'asc' };

    expect(toWeakSortSearchParams(sortState).toString()).toBe('sort=elementId&order=asc');
  });
});

describe('sortWeakElements', () => {
  it('missCount は降順で並び、同値は元の順序を保つ', () => {
    const sorted = sortWeakElements(WEAK_ELEMENTS, { key: 'missCount', order: 'desc' });

    expect(sorted.map((element) => element.elementId)).toEqual([26, 6, 8]);
  });

  it('addedAt は昇順で並ぶ', () => {
    const sorted = sortWeakElements(WEAK_ELEMENTS, { key: 'addedAt', order: 'asc' });

    expect(sorted.map((element) => element.elementId)).toEqual([8, 26, 6]);
  });

  it('elementId は昇順で並ぶ', () => {
    const sorted = sortWeakElements(WEAK_ELEMENTS, { key: 'elementId', order: 'asc' });

    expect(sorted.map((element) => element.elementId)).toEqual([6, 8, 26]);
  });

  it('nameJa は日本語名で昇順に並ぶ', () => {
    const sorted = sortWeakElements(WEAK_ELEMENTS, { key: 'nameJa', order: 'asc' });

    expect(sorted.map((element) => element.nameJa)).toEqual(['酸素', '炭素', '鉄']);
  });

  it('元配列を破壊しない', () => {
    const sorted = sortWeakElements(WEAK_ELEMENTS, { key: 'elementId', order: 'asc' });

    expect(sorted).not.toBe(WEAK_ELEMENTS);
    expect(WEAK_ELEMENTS.map((element) => element.elementId)).toEqual([26, 8, 6]);
  });
});
