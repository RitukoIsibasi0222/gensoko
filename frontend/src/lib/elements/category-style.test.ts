import { describe, expect, it } from 'vitest';
import { ELEMENT_CATEGORY_STYLE_MAP, getElementCategoryStyle } from '$lib/elements/category-style';

describe('ELEMENT_CATEGORY_STYLE_MAP', () => {
  it('分類スタイルを10種類定義している', () => {
    expect(Object.keys(ELEMENT_CATEGORY_STYLE_MAP)).toHaveLength(10);
  });
});

describe('getElementCategoryStyle', () => {
  it('既知カテゴリでは定義済みスタイルを返す', () => {
    expect(getElementCategoryStyle('非金属')).toEqual({
      cardClass: 'border-emerald-200 bg-emerald-50',
      badgeClass: 'bg-emerald-200 text-emerald-800'
    });
  });

  it('未知カテゴリではフォールバックスタイルを返す', () => {
    expect(getElementCategoryStyle('未知カテゴリ')).toEqual({
      cardClass: 'border-slate-200 bg-slate-50',
      badgeClass: 'bg-slate-200 text-slate-700'
    });
  });
});
