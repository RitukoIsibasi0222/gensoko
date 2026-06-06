import { API_BASE_URL } from '$lib/api/config';
import { ApiError, parseErrorResponse } from '$lib/api/errors';
import { normalizeElementSearchFilters, toElementSearchParams } from '$lib/elements/search-filter';
import type { ElementSearchFilterInput } from '$lib/elements/search-filter';
import type { Element, ElementMasteryStatus } from '$lib/elements/types';

type ElementsResponse = {
  elements: Element[];
};

type ElementResponse = {
  element: Element;
};

export type GetElementsOptions = {
  accessToken?: string | null;
  filters?: ElementSearchFilterInput;
  signal?: AbortSignal;
};

export type GetElementOptions = {
  signal?: AbortSignal;
};

type GetElementsFetchOptions = {
  method: 'GET';
  credentials: 'include';
  headers?: {
    Authorization: string;
  };
  signal?: AbortSignal;
};

type GetElementFetchOptions = {
  method: 'GET';
  credentials: 'include';
  signal?: AbortSignal;
};

function isElementMasteryStatus(value: unknown): value is ElementMasteryStatus {
  return value === 'unlearned' || value === 'learning' || value === 'mastered';
}

function isElement(value: unknown): value is Element {
  const masteryStatus = (value as Record<string, unknown> | null)?.masteryStatus;

  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).id === 'number' &&
    typeof (value as Record<string, unknown>).symbol === 'string' &&
    typeof (value as Record<string, unknown>).nameJa === 'string' &&
    typeof (value as Record<string, unknown>).nameEn === 'string' &&
    typeof (value as Record<string, unknown>).category === 'string' &&
    typeof (value as Record<string, unknown>).period === 'number' &&
    ((value as Record<string, unknown>).group === null ||
      typeof (value as Record<string, unknown>).group === 'number') &&
    ((value as Record<string, unknown>).atomicWeight === null ||
      typeof (value as Record<string, unknown>).atomicWeight === 'number') &&
    ((value as Record<string, unknown>).etymology === null ||
      typeof (value as Record<string, unknown>).etymology === 'string') &&
    (masteryStatus === undefined || isElementMasteryStatus(masteryStatus))
  );
}

function isElementsResponse(value: unknown): value is ElementsResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const elements = (value as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) {
    return false;
  }

  return elements.every((item: unknown) => isElement(item));
}

function isElementResponse(value: unknown): value is ElementResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return isElement((value as { element?: unknown }).element);
}

function buildElementsUrl(filters: ElementSearchFilterInput | undefined): string {
  const baseUrl = `${API_BASE_URL}/elements`;
  if (filters === undefined) {
    return baseUrl;
  }

  const searchParams = toElementSearchParams(normalizeElementSearchFilters(filters));
  const query = searchParams.toString();
  return query === '' ? baseUrl : `${baseUrl}?${query}`;
}

function buildElementUrl(id: number): string {
  return `${API_BASE_URL}/elements/${id}`;
}

export async function getElements(options: GetElementsOptions = {}): Promise<Element[]> {
  const fetchOptions: GetElementsFetchOptions = {
    method: 'GET',
    credentials: 'include'
  };

  if (options.accessToken) {
    fetchOptions.headers = {
      Authorization: `Bearer ${options.accessToken}`
    };
  }

  if (options.signal) {
    fetchOptions.signal = options.signal;
  }

  const response = await fetch(buildElementsUrl(options.filters), fetchOptions);

  if (!response.ok) {
    await parseErrorResponse(response, '元素一覧の取得に失敗しました');
  }

  const data = (await response.json()) as unknown;
  if (!isElementsResponse(data)) {
    throw new ApiError(500, '元素一覧のレスポンス形式が不正です', data);
  }

  return data.elements;
}

export async function getElement(id: number, options: GetElementOptions = {}): Promise<Element> {
  const fetchOptions: GetElementFetchOptions = {
    method: 'GET',
    credentials: 'include'
  };

  if (options.signal) {
    fetchOptions.signal = options.signal;
  }

  const response = await fetch(buildElementUrl(id), fetchOptions);

  if (!response.ok) {
    await parseErrorResponse(response, '元素詳細の取得に失敗しました');
  }

  const data = (await response.json()) as unknown;
  if (!isElementResponse(data)) {
    throw new ApiError(500, '元素詳細のレスポンス形式が不正です', data);
  }

  return data.element;
}
