import { API_BASE_URL } from '$lib/api/config';
import { ApiError, parseErrorResponse } from '$lib/api/errors';
import type { Element, ElementMasteryStatus } from '$lib/elements/types';

type ElementsResponse = {
  elements: Element[];
};

export type GetElementsOptions = {
  accessToken?: string | null;
};

type GetElementsFetchOptions = {
  method: 'GET';
  credentials: 'include';
  headers?: {
    Authorization: string;
  };
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

  const response = await fetch(`${API_BASE_URL}/elements`, {
    ...fetchOptions
  });

  if (!response.ok) {
    await parseErrorResponse(response, '元素一覧の取得に失敗しました');
  }

  const data = (await response.json()) as unknown;
  if (!isElementsResponse(data)) {
    throw new ApiError(500, '元素一覧のレスポンス形式が不正です', data);
  }

  return data.elements;
}
