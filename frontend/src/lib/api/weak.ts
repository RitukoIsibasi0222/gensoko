import { API_BASE_URL } from '$lib/api/config';
import { ApiError, parseErrorResponse } from '$lib/api/errors';

export type WeakElement = {
  elementId: number;
  symbol: string;
  nameJa: string;
  missCount: number;
  addedAt: string;
};

export type GetWeakElementsOptions = {
  accessToken: string;
  signal?: AbortSignal;
};

export type DeleteWeakElementOptions = {
  accessToken: string;
  elementId: number;
  signal?: AbortSignal;
};

export type DeleteWeakElementResponse = {
  message: string;
};

type GetWeakElementsFetchOptions = {
  method: 'GET';
  credentials: 'include';
  headers: {
    Authorization: string;
  };
  signal?: AbortSignal;
};

type DeleteWeakElementFetchOptions = {
  method: 'DELETE';
  credentials: 'include';
  headers: {
    Authorization: string;
  };
  signal?: AbortSignal;
};

type WeakElementsResponse = {
  weakElements: WeakElement[];
};

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isWeakElement(value: unknown): value is WeakElement {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const weakElement = value as Record<string, unknown>;
  const elementId = weakElement.elementId;
  const missCount = weakElement.missCount;

  return (
    isInteger(elementId) &&
    typeof weakElement.symbol === 'string' &&
    typeof weakElement.nameJa === 'string' &&
    isInteger(missCount) &&
    missCount >= 0 &&
    isValidDateString(weakElement.addedAt)
  );
}

function isWeakElementsResponse(value: unknown): value is WeakElementsResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return Array.isArray(response.weakElements) && response.weakElements.every(isWeakElement);
}

function isDeleteWeakElementResponse(value: unknown): value is DeleteWeakElementResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return typeof response.message === 'string';
}

function buildWeakElementsUrl(): string {
  return API_BASE_URL + '/weak';
}

function buildWeakElementUrl(elementId: number): string {
  return buildWeakElementsUrl() + '/' + encodeURIComponent(String(elementId));
}

export async function getWeakElements({
  accessToken,
  signal
}: GetWeakElementsOptions): Promise<WeakElement[]> {
  const fetchOptions: GetWeakElementsFetchOptions = {
    method: 'GET',
    credentials: 'include',
    headers: {
      Authorization: 'Bearer ' + accessToken
    }
  };

  if (signal) {
    fetchOptions.signal = signal;
  }

  const response = await fetch(buildWeakElementsUrl(), fetchOptions);

  if (!response.ok) {
    await parseErrorResponse(response, '苦手リストの取得に失敗しました');
  }

  const data = (await response.json()) as unknown;
  if (!isWeakElementsResponse(data)) {
    throw new ApiError(500, '苦手リストのレスポンス形式が不正です', data);
  }

  return data.weakElements;
}
export async function deleteWeakElement({
  accessToken,
  elementId,
  signal
}: DeleteWeakElementOptions): Promise<DeleteWeakElementResponse> {
  const fetchOptions: DeleteWeakElementFetchOptions = {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      Authorization: 'Bearer ' + accessToken
    }
  };

  if (signal) {
    fetchOptions.signal = signal;
  }

  const response = await fetch(buildWeakElementUrl(elementId), fetchOptions);

  if (!response.ok) {
    await parseErrorResponse(response, '苦手元素の削除に失敗しました');
  }

  const data = (await response.json()) as unknown;
  if (!isDeleteWeakElementResponse(data)) {
    throw new ApiError(500, '苦手元素削除のレスポンス形式が不正です', data);
  }

  return data;
}
