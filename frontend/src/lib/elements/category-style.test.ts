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
      cardClass: 'border-category-nonmetal-border bg-category-nonmetal-surface',
      badgeClass: 'bg-category-nonmetal-badge text-category-nonmetal-text'
    });
  });

  it('未知カテゴリではフォールバックスタイルを返す', () => {
    expect(getElementCategoryStyle('未知カテゴリ')).toEqual({
      cardClass: 'border-category-fallback-border bg-category-fallback-surface',
      badgeClass: 'bg-category-fallback-badge text-category-fallback-text'
    });
  });
});
