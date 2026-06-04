import { describe, expect, it } from 'vitest';
import type { Element } from '$lib/elements/types';
import {
  DEFAULT_ELEMENT_SEARCH_FILTERS,
  ELEMENT_PERIOD_OPTIONS,
  filterElements,
  getElementCategoryOptions,
  hasActiveElementSearchFilters,
  normalizeElementSearchFilters,
  readElementSearchFilters,
  toElementSearchParams
} from '$lib/elements/search-filter';

function createElement(overrides: Partial<Element> = {}): Element {
  return {
    id: 1,
    symbol: 'H',
    nameJa: '水素',
    nameEn: 'Hydrogen',
    category: '非金属',
    period: 1,
    group: 1,
    atomicWeight: 1.008,
    etymology: null,
    ...overrides
  };
}

const ELEMENTS: Element[] = [
  createElement(),
  createElement({
    id: 2,
    symbol: 'He',
    nameJa: 'ヘリウム',
    nameEn: 'Helium',
    category: '希ガス',
    period: 1,
    group: 18,
    atomicWeight: 4.0026
  }),
  createElement({
    id: 3,
    symbol: 'Li',
    nameJa: 'リチウム',
    nameEn: 'Lithium',
    category: 'アルカリ金属',
    period: 2,
    group: 1,
    atomicWeight: 6.94
  }),
  createElement({
    id: 6,
    symbol: 'C',
    nameJa: '炭素',
    nameEn: 'Carbon',
    category: '非金属',
    period: 2,
    group: 14,
    atomicWeight: 12.011
  }),
  createElement({
    id: 26,
    symbol: 'Fe',
    nameJa: '鉄',
    nameEn: 'Iron',
    category: '遷移金属',
    period: 4,
    group: 8,
    atomicWeight: 55.845
  })
];

describe('DEFAULT_ELEMENT_SEARCH_FILTERS', () => {
  it('検索条件の初期値を返す', () => {
    expect(DEFAULT_ELEMENT_SEARCH_FILTERS).toEqual({
      q: '',
      category: '',
      period: null
    });
  });
});

describe('ELEMENT_PERIOD_OPTIONS', () => {
  it('周期 1 から 7 を選択肢として返す', () => {
    expect(ELEMENT_PERIOD_OPTIONS).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('getElementCategoryOptions', () => {
  it('既存の分類スタイル定義から分類選択肢を返す', () => {
    expect(getElementCategoryOptions()).toEqual([
      '非金属',
      '希ガス',
      'アルカリ金属',
      'アルカリ土類金属',
      '遷移金属',
      '後遷移金属',
      '半金属',
      'ハロゲン',
      'ランタノイド',
      'アクチノイド'
    ]);
  });
});

describe('normalizeElementSearchFilters', () => {
  it('キーワードと分類の前後空白を trim する', () => {
    expect(
      normalizeElementSearchFilters({
        q: '  H  ',
        category: '  非金属  ',
        period: '1'
      })
    ).toEqual({
      q: 'H',
      category: '非金属',
      period: 1
    });
  });

  it('空文字・null・undefined は未指定として扱う', () => {
    expect(
      normalizeElementSearchFilters({
        q: '   ',
        category: null,
        period: undefined
      })
    ).toEqual(DEFAULT_ELEMENT_SEARCH_FILTERS);
  });

  it('未知の分類は未指定として扱う', () => {
    expect(normalizeElementSearchFilters({ category: '未知カテゴリ' }).category).toBe('');
  });

  it('period は 1 から 7 の整数だけ有効にする', () => {
    expect(normalizeElementSearchFilters({ period: 2 }).period).toBe(2);
    expect(normalizeElementSearchFilters({ period: '7' }).period).toBe(7);
    expect(normalizeElementSearchFilters({ period: '0' }).period).toBeNull();
    expect(normalizeElementSearchFilters({ period: '8' }).period).toBeNull();
    expect(normalizeElementSearchFilters({ period: '2.5' }).period).toBeNull();
    expect(normalizeElementSearchFilters({ period: 'abc' }).period).toBeNull();
  });
});

describe('filterElements', () => {
  it('未指定条件では全元素を返す', () => {
    expect(filterElements(ELEMENTS, DEFAULT_ELEMENT_SEARCH_FILTERS)).toEqual(ELEMENTS);
  });

  it('元素記号を大文字小文字を区別せず検索できる', () => {
    expect(filterElements(ELEMENTS, { q: 'fe', category: '', period: null })).toEqual([
      ELEMENTS[4]
    ]);
  });

  it('日本語名で検索できる', () => {
    expect(filterElements(ELEMENTS, { q: '水素', category: '', period: null })).toEqual([
      ELEMENTS[0]
    ]);
  });

  it('英語名を大文字小文字を区別せず検索できる', () => {
    expect(filterElements(ELEMENTS, { q: 'hydrogen', category: '', period: null })).toEqual([
      ELEMENTS[0]
    ]);
  });

  it('原子番号の部分一致で検索できる', () => {
    expect(filterElements(ELEMENTS, { q: '2', category: '', period: null })).toEqual([
      ELEMENTS[1],
      ELEMENTS[4]
    ]);
  });

  it('分類で絞り込める', () => {
    expect(filterElements(ELEMENTS, { q: '', category: '非金属', period: null })).toEqual([
      ELEMENTS[0],
      ELEMENTS[3]
    ]);
  });

  it('周期で絞り込める', () => {
    expect(filterElements(ELEMENTS, { q: '', category: '', period: 2 })).toEqual([
      ELEMENTS[2],
      ELEMENTS[3]
    ]);
  });

  it('キーワード・分類・周期を組み合わせて絞り込める', () => {
    expect(filterElements(ELEMENTS, { q: '炭', category: '非金属', period: 2 })).toEqual([
      ELEMENTS[3]
    ]);
  });
});

describe('readElementSearchFilters', () => {
  it('URLSearchParams から正規化済み検索条件を読む', () => {
    const params = new URLSearchParams('q=+H+&category=%E9%9D%9E%E9%87%91%E5%B1%9E&period=1');

    expect(readElementSearchFilters(params)).toEqual({
      q: 'H',
      category: '非金属',
      period: 1
    });
  });

  it('不正な URLSearchParams は未指定として扱う', () => {
    const params = new URLSearchParams('category=unknown&period=abc');

    expect(readElementSearchFilters(params)).toEqual(DEFAULT_ELEMENT_SEARCH_FILTERS);
  });
});

describe('toElementSearchParams', () => {
  it('指定済み条件だけ URLSearchParams に変換する', () => {
    const params = toElementSearchParams({
      q: 'H',
      category: '非金属',
      period: 1
    });

    expect(params.toString()).toBe('q=H&category=%E9%9D%9E%E9%87%91%E5%B1%9E&period=1');
  });

  it('未指定条件は URLSearchParams に含めない', () => {
    const params = toElementSearchParams(DEFAULT_ELEMENT_SEARCH_FILTERS);

    expect(params.toString()).toBe('');
  });
});

describe('hasActiveElementSearchFilters', () => {
  it('初期値では false を返す', () => {
    expect(hasActiveElementSearchFilters(DEFAULT_ELEMENT_SEARCH_FILTERS)).toBe(false);
  });

  it('いずれかの条件が指定されていれば true を返す', () => {
    expect(hasActiveElementSearchFilters({ q: 'H', category: '', period: null })).toBe(true);
    expect(hasActiveElementSearchFilters({ q: '', category: '非金属', period: null })).toBe(true);
    expect(hasActiveElementSearchFilters({ q: '', category: '', period: 1 })).toBe(true);
  });
});
