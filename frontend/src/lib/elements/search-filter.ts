import { ELEMENT_CATEGORY_STYLE_MAP } from '$lib/elements/category-style';
import type { Element } from '$lib/elements/types';

export type ElementSearchFilters = {
  q: string;
  category: string;
  period: number | null;
};

export type ElementSearchFilterInput = {
  q?: string | null;
  category?: string | null;
  period?: string | number | null;
};

export type ElementSearchFilterApplyHandler = (filters: ElementSearchFilters) => void;

export const DEFAULT_ELEMENT_SEARCH_FILTERS: ElementSearchFilters = {
  q: '',
  category: '',
  period: null
};

export const ELEMENT_PERIOD_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

export function getElementCategoryOptions(): string[] {
  return Object.keys(ELEMENT_CATEGORY_STYLE_MAP);
}

function normalizeKeyword(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function normalizeCategory(value: string | null | undefined): string {
  const category = value?.trim() ?? '';
  return Object.hasOwn(ELEMENT_CATEGORY_STYLE_MAP, category) ? category : '';
}

function normalizePeriod(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const period = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(period)) {
    return null;
  }

  return ELEMENT_PERIOD_OPTIONS.includes(period as (typeof ELEMENT_PERIOD_OPTIONS)[number])
    ? period
    : null;
}

export function normalizeElementSearchFilters(
  input: ElementSearchFilterInput
): ElementSearchFilters {
  return {
    q: normalizeKeyword(input.q),
    category: normalizeCategory(input.category),
    period: normalizePeriod(input.period)
  };
}

export function filterElements(
  elements: readonly Element[],
  filters: ElementSearchFilters
): Element[] {
  const keyword = filters.q;
  const keywordLower = keyword.toLowerCase();

  return elements.filter((element) => {
    if (keyword !== '') {
      const matchesKeyword =
        String(element.id).includes(keyword) ||
        element.symbol.toLowerCase().includes(keywordLower) ||
        element.nameJa.includes(keyword) ||
        element.nameEn.toLowerCase().includes(keywordLower);

      if (!matchesKeyword) {
        return false;
      }
    }

    if (filters.category !== '' && element.category !== filters.category) {
      return false;
    }

    if (filters.period !== null && element.period !== filters.period) {
      return false;
    }

    return true;
  });
}

export function readElementSearchFilters(searchParams: URLSearchParams): ElementSearchFilters {
  return normalizeElementSearchFilters({
    q: searchParams.get('q'),
    category: searchParams.get('category'),
    period: searchParams.get('period')
  });
}

export function toElementSearchParams(filters: ElementSearchFilters): URLSearchParams {
  const searchParams = new URLSearchParams();

  if (filters.q !== '') {
    searchParams.set('q', filters.q);
  }

  if (filters.category !== '') {
    searchParams.set('category', filters.category);
  }

  if (filters.period !== null) {
    searchParams.set('period', String(filters.period));
  }

  return searchParams;
}

export function hasActiveElementSearchFilters(filters: ElementSearchFilters): boolean {
  return filters.q !== '' || filters.category !== '' || filters.period !== null;
}
