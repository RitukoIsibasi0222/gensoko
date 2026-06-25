import type { WeakElement } from '$lib/api/weak';

export type WeakSortKey = 'missCount' | 'addedAt' | 'elementId' | 'nameJa';
export type WeakSortOrder = 'asc' | 'desc';

export type WeakSortState = {
  key: WeakSortKey;
  order: WeakSortOrder;
};

export const DEFAULT_WEAK_SORT_STATE: WeakSortState = {
  key: 'missCount',
  order: 'desc'
};

const WEAK_SORT_KEYS: readonly WeakSortKey[] = ['missCount', 'addedAt', 'elementId', 'nameJa'];
const WEAK_SORT_ORDERS: readonly WeakSortOrder[] = ['asc', 'desc'];

function isWeakSortKey(value: string | null): value is WeakSortKey {
  return WEAK_SORT_KEYS.includes(value as WeakSortKey);
}

function isWeakSortOrder(value: string | null): value is WeakSortOrder {
  return WEAK_SORT_ORDERS.includes(value as WeakSortOrder);
}

function compareWeakElements(left: WeakElement, right: WeakElement, key: WeakSortKey): number {
  if (key === 'missCount') {
    return left.missCount - right.missCount;
  }

  if (key === 'addedAt') {
    return Date.parse(left.addedAt) - Date.parse(right.addedAt);
  }

  if (key === 'elementId') {
    return left.elementId - right.elementId;
  }

  return left.nameJa.localeCompare(right.nameJa, 'ja');
}

export function readWeakSortState(searchParams: URLSearchParams): WeakSortState {
  const sortKey = searchParams.get('sort');
  const sortOrder = searchParams.get('order');

  return {
    key: isWeakSortKey(sortKey) ? sortKey : DEFAULT_WEAK_SORT_STATE.key,
    order: isWeakSortOrder(sortOrder) ? sortOrder : DEFAULT_WEAK_SORT_STATE.order
  };
}

export function toWeakSortSearchParams(sortState: WeakSortState): URLSearchParams {
  const searchParams = new URLSearchParams();

  if (
    sortState.key === DEFAULT_WEAK_SORT_STATE.key &&
    sortState.order === DEFAULT_WEAK_SORT_STATE.order
  ) {
    return searchParams;
  }

  searchParams.set('sort', sortState.key);
  searchParams.set('order', sortState.order);
  return searchParams;
}

export function sortWeakElements(
  weakElements: readonly WeakElement[],
  sortState: WeakSortState
): WeakElement[] {
  const direction = sortState.order === 'asc' ? 1 : -1;

  return weakElements
    .map((weakElement, index) => ({ weakElement, index }))
    .sort((left, right) => {
      const comparison = compareWeakElements(left.weakElement, right.weakElement, sortState.key);

      if (comparison !== 0) {
        return comparison * direction;
      }

      return left.index - right.index;
    })
    .map(({ weakElement }) => weakElement);
}
