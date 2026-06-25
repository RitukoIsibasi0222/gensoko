import { API_BASE_URL } from '$lib/api/config';
import { ApiError, parseErrorResponse } from '$lib/api/errors';

export type MyStatsSummary = {
  totalGames: number;
  totalCorrect: number;
  totalAnswered: number;
  averageAccuracyRate: number;
  masteredCount: number;
  currentStreak: number;
  weeklyScore: number;
  allTimeScore: number;
  lastActiveDate: string | null;
  updatedAt: string | null;
};

export type MyAccuracyTrendItem = {
  sessionId: string;
  playedAt: string;
  correctCount: number;
  totalCount: number;
  accuracyRate: number;
};

export type MyStatsResponse = {
  stats: MyStatsSummary;
  recentAccuracyTrend: MyAccuracyTrendItem[];
};

export type GetMyStatsOptions = {
  accessToken: string;
  signal?: AbortSignal;
};

type GetMyStatsFetchOptions = {
  method: 'GET';
  credentials: 'include';
  headers: {
    Authorization: string;
  };
  signal?: AbortSignal;
};

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isAccuracyRate(value: unknown): value is number {
  return isNonNegativeInteger(value) && value <= 100;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isNullableDateString(value: unknown): value is string | null {
  return value === null || isValidDateString(value);
}

function isMyStatsSummary(value: unknown): value is MyStatsSummary {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const stats = value as Record<string, unknown>;
  return (
    isNonNegativeInteger(stats.totalGames) &&
    isNonNegativeInteger(stats.totalCorrect) &&
    isNonNegativeInteger(stats.totalAnswered) &&
    isAccuracyRate(stats.averageAccuracyRate) &&
    isNonNegativeInteger(stats.masteredCount) &&
    isNonNegativeInteger(stats.currentStreak) &&
    isNonNegativeInteger(stats.weeklyScore) &&
    isNonNegativeInteger(stats.allTimeScore) &&
    isNullableDateString(stats.lastActiveDate) &&
    isNullableDateString(stats.updatedAt)
  );
}

function isMyAccuracyTrendItem(value: unknown): value is MyAccuracyTrendItem {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.sessionId === 'string' &&
    isValidDateString(item.playedAt) &&
    isNonNegativeInteger(item.correctCount) &&
    isNonNegativeInteger(item.totalCount) &&
    isAccuracyRate(item.accuracyRate)
  );
}

function isMyStatsResponse(value: unknown): value is MyStatsResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    isMyStatsSummary(response.stats) &&
    Array.isArray(response.recentAccuracyTrend) &&
    response.recentAccuracyTrend.every(isMyAccuracyTrendItem)
  );
}

function buildMyStatsUrl(): string {
  return API_BASE_URL + '/users/me/stats';
}

export async function getMyStats({
  accessToken,
  signal
}: GetMyStatsOptions): Promise<MyStatsResponse> {
  const fetchOptions: GetMyStatsFetchOptions = {
    method: 'GET',
    credentials: 'include',
    headers: {
      Authorization: 'Bearer ' + accessToken
    }
  };

  if (signal) {
    fetchOptions.signal = signal;
  }

  const response = await fetch(buildMyStatsUrl(), fetchOptions);

  if (!response.ok) {
    await parseErrorResponse(response, '統計情報の取得に失敗しました');
  }

  const data = (await response.json()) as unknown;
  if (!isMyStatsResponse(data)) {
    throw new ApiError(500, '統計情報のレスポンス形式が不正です', data);
  }

  return data;
}
