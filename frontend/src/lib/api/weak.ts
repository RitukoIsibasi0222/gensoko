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

type GetWeakElementsFetchOptions = {
  method: 'GET';
  credentials: 'include';
  headers: {
    Authorization: string;
  };
  signal?: AbortSignal;
};

type WeakElementsResponse = {
  weakElements: WeakElement[];
};

function isWeakElement(value: unknown): value is WeakElement {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const weakElement = value as Record<string, unknown>;
  return (
    typeof weakElement.elementId === 'number' &&
    typeof weakElement.symbol === 'string' &&
    typeof weakElement.nameJa === 'string' &&
    typeof weakElement.missCount === 'number' &&
    typeof weakElement.addedAt === 'string'
  );
}

function isWeakElementsResponse(value: unknown): value is WeakElementsResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return Array.isArray(response.weakElements) && response.weakElements.every(isWeakElement);
}

function buildWeakElementsUrl(): string {
  return API_BASE_URL + '/weak';
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
