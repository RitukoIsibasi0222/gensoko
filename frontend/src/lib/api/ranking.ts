import { API_BASE_URL } from '$lib/api/config';
import { ApiError, parseErrorResponse } from '$lib/api/errors';

export type RankingPeriod = 'weekly' | 'alltime';

export type RankingEntry = {
  rank: number;
  username: string;
  score: number;
  totalGames: number;
  accuracyRate: number;
};

export type RankingResponse = {
  period: RankingPeriod;
  ranking: RankingEntry[];
  myRank: number | null;
};

export type GetRankingOptions = {
  period: RankingPeriod;
  accessToken?: string | null;
  signal?: AbortSignal;
};

type RankingFetchOptions = {
  method: 'GET';
  credentials: 'include';
  headers?: {
    Authorization: string;
  };
  signal?: AbortSignal;
};

type RawWeeklyRankingEntry = {
  rank: number;
  username: string;
  weeklyScore: number;
  totalGames: number;
  accuracyRate: number;
};

type RawAllTimeRankingEntry = {
  rank: number;
  username: string;
  allTimeScore: number;
  totalGames: number;
  accuracyRate: number;
};

type RawWeeklyRankingResponse = {
  ranking: RawWeeklyRankingEntry[];
  myRank: number | null;
};

type RawAllTimeRankingResponse = {
  ranking: RawAllTimeRankingEntry[];
  myRank: number | null;
};

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isAccuracyRate(value: unknown): value is number {
  return isNonNegativeInteger(value) && value <= 100;
}

function isMyRank(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value);
}

function isBaseRankingEntry(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    isPositiveInteger(entry.rank) &&
    typeof entry.username === 'string' &&
    isNonNegativeInteger(entry.totalGames) &&
    isAccuracyRate(entry.accuracyRate)
  );
}

function isRawWeeklyRankingEntry(value: unknown): value is RawWeeklyRankingEntry {
  return isBaseRankingEntry(value) && isNonNegativeInteger(value.weeklyScore);
}

function isRawAllTimeRankingEntry(value: unknown): value is RawAllTimeRankingEntry {
  return isBaseRankingEntry(value) && isNonNegativeInteger(value.allTimeScore);
}

function isRawWeeklyRankingResponse(value: unknown): value is RawWeeklyRankingResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    Array.isArray(response.ranking) &&
    response.ranking.every(isRawWeeklyRankingEntry) &&
    isMyRank(response.myRank)
  );
}

function isRawAllTimeRankingResponse(value: unknown): value is RawAllTimeRankingResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    Array.isArray(response.ranking) &&
    response.ranking.every(isRawAllTimeRankingEntry) &&
    isMyRank(response.myRank)
  );
}

function buildRankingUrl(period: RankingPeriod): string {
  return API_BASE_URL + '/ranking/' + period;
}

function normalizeWeeklyResponse(response: RawWeeklyRankingResponse): RankingResponse {
  return {
    period: 'weekly',
    ranking: response.ranking.map((entry) => ({
      rank: entry.rank,
      username: entry.username,
      score: entry.weeklyScore,
      totalGames: entry.totalGames,
      accuracyRate: entry.accuracyRate
    })),
    myRank: response.myRank
  };
}

function normalizeAllTimeResponse(response: RawAllTimeRankingResponse): RankingResponse {
  return {
    period: 'alltime',
    ranking: response.ranking.map((entry) => ({
      rank: entry.rank,
      username: entry.username,
      score: entry.allTimeScore,
      totalGames: entry.totalGames,
      accuracyRate: entry.accuracyRate
    })),
    myRank: response.myRank
  };
}

function validateAndNormalizeRankingResponse(
  period: RankingPeriod,
  data: unknown
): RankingResponse {
  if (period === 'weekly' && isRawWeeklyRankingResponse(data)) {
    return normalizeWeeklyResponse(data);
  }

  if (period === 'alltime' && isRawAllTimeRankingResponse(data)) {
    return normalizeAllTimeResponse(data);
  }

  throw new ApiError(500, 'ランキングのレスポンス形式が不正です', data);
}

export async function getRanking({
  period,
  accessToken,
  signal
}: GetRankingOptions): Promise<RankingResponse> {
  const fetchOptions: RankingFetchOptions = {
    method: 'GET',
    credentials: 'include'
  };

  const normalizedAccessToken = accessToken?.trim() ?? '';
  if (normalizedAccessToken.length > 0) {
    fetchOptions.headers = {
      Authorization: 'Bearer ' + normalizedAccessToken
    };
  }

  if (signal) {
    fetchOptions.signal = signal;
  }

  const response = await fetch(buildRankingUrl(period), fetchOptions);

  if (!response.ok) {
    await parseErrorResponse(response, 'ランキングの取得に失敗しました');
  }

  let data: unknown;
  try {
    data = (await response.json()) as unknown;
  } catch {
    throw new ApiError(500, 'ランキングのレスポンス形式が不正です', null);
  }

  return validateAndNormalizeRankingResponse(period, data);
}
