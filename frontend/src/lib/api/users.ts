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

function isValidCountPair(correctCount: unknown, totalCount: unknown): boolean {
  return (
    isNonNegativeInteger(correctCount) &&
    isNonNegativeInteger(totalCount) &&
    correctCount <= totalCount
  );
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
    isValidCountPair(stats.totalCorrect, stats.totalAnswered) &&
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
    isValidCountPair(item.correctCount, item.totalCount) &&
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

  let data: unknown;
  try {
    data = (await response.json()) as unknown;
  } catch {
    throw new ApiError(500, '統計情報のレスポンス形式が不正です', null);
  }

  if (!isMyStatsResponse(data)) {
    throw new ApiError(500, '統計情報のレスポンス形式が不正です', data);
  }

  return data;
}

export type CurrentUserRole = 'USER' | 'ADMIN';

export type CurrentUserProfile = {
  id: string;
  username: string;
  email: string;
  role: CurrentUserRole;
  createdAt: string;
};

export type UpdateCurrentUsernameResponse = {
  message: string;
  user: {
    id: string;
    username: string;
    role: CurrentUserRole;
  };
};

export type UserMessageResponse = {
  message: string;
};

export type GetCurrentUserProfileOptions = {
  accessToken: string;
  signal?: AbortSignal;
};

export type UpdateCurrentUsernameOptions = {
  accessToken: string;
  username: string;
  signal?: AbortSignal;
};

export type ChangeCurrentPasswordOptions = {
  accessToken: string;
  currentPassword: string;
  newPassword: string;
  signal?: AbortSignal;
};

export type DeleteCurrentUserOptions = {
  accessToken: string;
  currentPassword: string;
  signal?: AbortSignal;
};

type UsersMeFetchOptions = {
  method: 'GET' | 'PATCH' | 'DELETE';
  credentials: 'include';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

function isCurrentUserRole(value: unknown): value is CurrentUserRole {
  return value === 'USER' || value === 'ADMIN';
}

function isCurrentUserProfile(value: unknown): value is CurrentUserProfile {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const user = value as Record<string, unknown>;
  return (
    typeof user.id === 'string' &&
    typeof user.username === 'string' &&
    typeof user.email === 'string' &&
    isCurrentUserRole(user.role) &&
    isValidDateString(user.createdAt)
  );
}

function isCurrentUserProfileResponse(value: unknown): value is { user: CurrentUserProfile } {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return isCurrentUserProfile(response.user);
}

function isUpdateCurrentUsernameResponse(value: unknown): value is UpdateCurrentUsernameResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  const user = response.user;
  if (user === null || typeof user !== 'object') {
    return false;
  }

  const updatedUser = user as Record<string, unknown>;
  return (
    typeof response.message === 'string' &&
    typeof updatedUser.id === 'string' &&
    typeof updatedUser.username === 'string' &&
    isCurrentUserRole(updatedUser.role)
  );
}

function isUserMessageResponse(value: unknown): value is UserMessageResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return typeof response.message === 'string';
}

function buildUsersMeUrl(): string {
  return API_BASE_URL + '/users/me';
}

function buildUsersMeFetchOptions({
  accessToken,
  method,
  body,
  signal
}: {
  accessToken: string;
  method: 'GET' | 'PATCH' | 'DELETE';
  body?: Record<string, string>;
  signal?: AbortSignal;
}): UsersMeFetchOptions {
  const headers: Record<string, string> = {
    Authorization: 'Bearer ' + accessToken
  };

  const fetchOptions: UsersMeFetchOptions = {
    method,
    credentials: 'include',
    headers
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(body);
  }

  if (signal) {
    fetchOptions.signal = signal;
  }

  return fetchOptions;
}

async function parseJsonOrThrow(response: Response, invalidMessage: string): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ApiError(500, invalidMessage, null);
  }
}

export async function getCurrentUserProfile({
  accessToken,
  signal
}: GetCurrentUserProfileOptions): Promise<CurrentUserProfile> {
  const response = await fetch(
    buildUsersMeUrl(),
    buildUsersMeFetchOptions({ accessToken, method: 'GET', signal })
  );

  if (!response.ok) {
    await parseErrorResponse(response, 'プロフィール情報の取得に失敗しました');
  }

  const data = await parseJsonOrThrow(response, 'プロフィール情報のレスポンス形式が不正です');
  if (!isCurrentUserProfileResponse(data)) {
    throw new ApiError(500, 'プロフィール情報のレスポンス形式が不正です', data);
  }

  return data.user;
}

export async function updateCurrentUsername({
  accessToken,
  username,
  signal
}: UpdateCurrentUsernameOptions): Promise<UpdateCurrentUsernameResponse> {
  const response = await fetch(
    buildUsersMeUrl(),
    buildUsersMeFetchOptions({
      accessToken,
      method: 'PATCH',
      body: { username },
      signal
    })
  );

  if (!response.ok) {
    await parseErrorResponse(response, 'ユーザー名変更に失敗しました');
  }

  const data = await parseJsonOrThrow(response, 'ユーザー名変更のレスポンス形式が不正です');
  if (!isUpdateCurrentUsernameResponse(data)) {
    throw new ApiError(500, 'ユーザー名変更のレスポンス形式が不正です', data);
  }

  return data;
}

export async function changeCurrentPassword({
  accessToken,
  currentPassword,
  newPassword,
  signal
}: ChangeCurrentPasswordOptions): Promise<UserMessageResponse> {
  const response = await fetch(
    buildUsersMeUrl(),
    buildUsersMeFetchOptions({
      accessToken,
      method: 'PATCH',
      body: { currentPassword, newPassword },
      signal
    })
  );

  if (!response.ok) {
    await parseErrorResponse(response, 'パスワード変更に失敗しました');
  }

  const data = await parseJsonOrThrow(response, 'パスワード変更のレスポンス形式が不正です');
  if (!isUserMessageResponse(data)) {
    throw new ApiError(500, 'パスワード変更のレスポンス形式が不正です', data);
  }

  return data;
}

export async function deleteCurrentUser({
  accessToken,
  currentPassword,
  signal
}: DeleteCurrentUserOptions): Promise<UserMessageResponse> {
  const response = await fetch(
    buildUsersMeUrl(),
    buildUsersMeFetchOptions({
      accessToken,
      method: 'DELETE',
      body: { currentPassword },
      signal
    })
  );

  if (!response.ok) {
    await parseErrorResponse(response, 'アカウント削除に失敗しました');
  }

  const data = await parseJsonOrThrow(response, 'アカウント削除のレスポンス形式が不正です');
  if (!isUserMessageResponse(data)) {
    throw new ApiError(500, 'アカウント削除のレスポンス形式が不正です', data);
  }

  return data;
}
