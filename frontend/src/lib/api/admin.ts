import { API_BASE_URL } from '$lib/api/config';
import { ApiError, parseErrorResponse, parseSuccessJsonResponse } from '$lib/api/errors';

export type AdminUserRole = 'USER' | 'ADMIN';
export type AdminUserStatus = 'active' | 'suspended' | 'deleted';

export type AdminUserSummary = {
  id: string;
  username: string;
  email: string;
  role: AdminUserRole;
  emailVerified: boolean;
  isActive: boolean;
  deletedAt: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserListItem = AdminUserSummary & {
  stats: {
    totalGames: number;
    accuracyRate: number;
    weeklyScore: number;
    allTimeScore: number;
  };
};

export type AdminUserDetail = AdminUserSummary & {
  loginFailCount: number;
  stats: {
    totalGames: number;
    totalCorrect: number;
    totalAnswered: number;
    accuracyRate: number;
    masteredCount: number;
    currentStreak: number;
    weeklyScore: number;
    allTimeScore: number;
    lastActiveDate: string | null;
    updatedAt: string | null;
  };
};

export type AdminUsersQuery = {
  limit?: number;
  cursor?: string;
  q?: string;
  role?: AdminUserRole;
  status?: AdminUserStatus;
};

export type AdminUsersResponse = {
  users: AdminUserListItem[];
  nextCursor: string | null;
};

export type AdminStats = {
  users: {
    total: number;
    active: number;
    suspended: number;
    deleted: number;
    admins: number;
    emailVerified: number;
  };
  games: {
    totalSessions: number;
    totalAnswered: number;
    averageAccuracyRate: number;
  };
  learning: {
    totalWeakElements: number;
    totalMasteredCount: number;
  };
};

export type AdminUserMutationResponse = {
  message: string;
  user: AdminUserSummary;
};

export type AdminMessageResponse = {
  message: string;
};

export type GetAdminUsersOptions = {
  accessToken: string;
  query?: AdminUsersQuery;
  signal?: AbortSignal;
};

export type GetAdminUserDetailOptions = {
  accessToken: string;
  userId: string;
  signal?: AbortSignal;
};

export type GetAdminStatsOptions = {
  accessToken: string;
  signal?: AbortSignal;
};

export type UpdateAdminUserStatusOptions = {
  accessToken: string;
  userId: string;
  isActive: boolean;
  signal?: AbortSignal;
};

export type UpdateAdminUserRoleOptions = {
  accessToken: string;
  userId: string;
  role: AdminUserRole;
  signal?: AbortSignal;
};

export type DeleteAdminUserOptions = {
  accessToken: string;
  userId: string;
  signal?: AbortSignal;
};

type AdminFetchOptions = {
  method: 'GET' | 'PATCH' | 'DELETE';
  credentials: 'include';
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

type AdminRequestOptions<T> = {
  url: string;
  accessToken: string;
  method: AdminFetchOptions['method'];
  invalidMessage: string;
  isValidResponse: (value: unknown) => value is T;
  body?: Record<string, unknown>;
  signal?: AbortSignal;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isAccuracyRate(value: unknown): value is number {
  return isNonNegativeInteger(value) && value <= 100;
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isNullableDateString(value: unknown): value is string | null {
  return value === null || isValidDateString(value);
}

function isAdminUserRole(value: unknown): value is AdminUserRole {
  return value === 'USER' || value === 'ADMIN';
}

function isAdminUserSummary(value: unknown): value is AdminUserSummary {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.username === 'string' &&
    typeof value.email === 'string' &&
    isAdminUserRole(value.role) &&
    typeof value.emailVerified === 'boolean' &&
    typeof value.isActive === 'boolean' &&
    isNullableDateString(value.deletedAt) &&
    isNullableDateString(value.lockedUntil) &&
    isNullableDateString(value.lastLoginAt) &&
    isValidDateString(value.createdAt) &&
    isValidDateString(value.updatedAt)
  );
}

function isAdminUserListItem(value: unknown): value is AdminUserListItem {
  if (!isRecord(value)) {
    return false;
  }

  const stats = value.stats;
  if (!isAdminUserSummary(value) || !isRecord(stats)) {
    return false;
  }

  return (
    isNonNegativeInteger(stats.totalGames) &&
    isAccuracyRate(stats.accuracyRate) &&
    isNonNegativeInteger(stats.weeklyScore) &&
    isNonNegativeInteger(stats.allTimeScore)
  );
}

function isAdminUsersResponse(value: unknown): value is AdminUsersResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.users) ||
    !value.users.every(isAdminUserListItem) ||
    (value.nextCursor !== null && typeof value.nextCursor !== 'string')
  ) {
    return false;
  }

  const userIds = value.users.map((user) => user.id);
  return new Set(userIds).size === userIds.length;
}

function isAdminUserDetail(value: unknown): value is AdminUserDetail {
  if (!isRecord(value)) {
    return false;
  }

  const loginFailCount = value.loginFailCount;
  const stats = value.stats;
  if (!isAdminUserSummary(value) || !isNonNegativeInteger(loginFailCount) || !isRecord(stats)) {
    return false;
  }

  return (
    isNonNegativeInteger(stats.totalGames) &&
    isNonNegativeInteger(stats.totalCorrect) &&
    isNonNegativeInteger(stats.totalAnswered) &&
    isAccuracyRate(stats.accuracyRate) &&
    isNonNegativeInteger(stats.masteredCount) &&
    isNonNegativeInteger(stats.currentStreak) &&
    isNonNegativeInteger(stats.weeklyScore) &&
    isNonNegativeInteger(stats.allTimeScore) &&
    isNullableDateString(stats.lastActiveDate) &&
    isNullableDateString(stats.updatedAt)
  );
}

function isAdminUserDetailResponse(value: unknown): value is { user: AdminUserDetail } {
  return isRecord(value) && isAdminUserDetail(value.user);
}

function isAdminStats(value: unknown): value is AdminStats {
  if (!isRecord(value) || !isRecord(value.users) || !isRecord(value.games)) {
    return false;
  }

  if (!isRecord(value.learning)) {
    return false;
  }

  return (
    isNonNegativeInteger(value.users.total) &&
    isNonNegativeInteger(value.users.active) &&
    isNonNegativeInteger(value.users.suspended) &&
    isNonNegativeInteger(value.users.deleted) &&
    isNonNegativeInteger(value.users.admins) &&
    isNonNegativeInteger(value.users.emailVerified) &&
    isNonNegativeInteger(value.games.totalSessions) &&
    isNonNegativeInteger(value.games.totalAnswered) &&
    isAccuracyRate(value.games.averageAccuracyRate) &&
    isNonNegativeInteger(value.learning.totalWeakElements) &&
    isNonNegativeInteger(value.learning.totalMasteredCount)
  );
}

function isAdminUserMutationResponse(value: unknown): value is AdminUserMutationResponse {
  return isRecord(value) && typeof value.message === 'string' && isAdminUserSummary(value.user);
}

function isAdminMessageResponse(value: unknown): value is AdminMessageResponse {
  return isRecord(value) && typeof value.message === 'string';
}

function buildAdminUsersUrl(query: AdminUsersQuery | undefined): string {
  const params = new URLSearchParams();

  if (query?.limit !== undefined) {
    params.set('limit', String(query.limit));
  }
  if (query?.cursor) {
    params.set('cursor', query.cursor);
  }
  if (query?.q) {
    params.set('q', query.q);
  }
  if (query?.role) {
    params.set('role', query.role);
  }
  if (query?.status) {
    params.set('status', query.status);
  }

  const queryString = params.toString();
  return API_BASE_URL + '/admin/users' + (queryString ? '?' + queryString : '');
}

function buildAdminUserUrl(userId: string, suffix = ''): string {
  return API_BASE_URL + '/admin/users/' + encodeURIComponent(userId) + suffix;
}

function buildAdminFetchOptions({
  accessToken,
  method,
  body,
  signal
}: {
  accessToken: string;
  method: AdminFetchOptions['method'];
  body?: Record<string, unknown>;
  signal?: AbortSignal;
}): AdminFetchOptions {
  const headers: Record<string, string> = {
    Authorization: 'Bearer ' + accessToken
  };
  const options: AdminFetchOptions = {
    method,
    credentials: 'include',
    headers
  };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  if (signal) {
    options.signal = signal;
  }

  return options;
}

async function requestAdminJson<T>({
  url,
  accessToken,
  method,
  invalidMessage,
  isValidResponse,
  body,
  signal
}: AdminRequestOptions<T>): Promise<T> {
  const response = await fetch(
    url,
    buildAdminFetchOptions({
      accessToken,
      method,
      body,
      signal
    })
  );

  if (!response.ok) {
    await parseErrorResponse(response, invalidMessage);
  }

  const data = await parseSuccessJsonResponse(response, invalidMessage);
  if (!isValidResponse(data)) {
    throw new ApiError(500, invalidMessage, data);
  }

  return data;
}

export function getAdminUsers({
  accessToken,
  query,
  signal
}: GetAdminUsersOptions): Promise<AdminUsersResponse> {
  return requestAdminJson({
    url: buildAdminUsersUrl(query),
    accessToken,
    method: 'GET',
    invalidMessage: 'ユーザー一覧のレスポンス形式が不正です',
    isValidResponse: isAdminUsersResponse,
    signal
  });
}

export function getAdminUserDetail({
  accessToken,
  userId,
  signal
}: GetAdminUserDetailOptions): Promise<{ user: AdminUserDetail }> {
  return requestAdminJson({
    url: buildAdminUserUrl(userId),
    accessToken,
    method: 'GET',
    invalidMessage: 'ユーザー詳細のレスポンス形式が不正です',
    isValidResponse: isAdminUserDetailResponse,
    signal
  });
}

export function getAdminStats({ accessToken, signal }: GetAdminStatsOptions): Promise<AdminStats> {
  return requestAdminJson({
    url: API_BASE_URL + '/admin/stats',
    accessToken,
    method: 'GET',
    invalidMessage: '管理者統計のレスポンス形式が不正です',
    isValidResponse: isAdminStats,
    signal
  });
}

export function updateAdminUserStatus({
  accessToken,
  userId,
  isActive,
  signal
}: UpdateAdminUserStatusOptions): Promise<AdminUserMutationResponse> {
  return requestAdminJson({
    url: buildAdminUserUrl(userId, '/status'),
    accessToken,
    method: 'PATCH',
    invalidMessage: 'アカウント状態変更のレスポンス形式が不正です',
    isValidResponse: isAdminUserMutationResponse,
    body: { isActive },
    signal
  });
}

export function updateAdminUserRole({
  accessToken,
  userId,
  role,
  signal
}: UpdateAdminUserRoleOptions): Promise<AdminUserMutationResponse> {
  return requestAdminJson({
    url: buildAdminUserUrl(userId, '/role'),
    accessToken,
    method: 'PATCH',
    invalidMessage: 'ロール変更のレスポンス形式が不正です',
    isValidResponse: isAdminUserMutationResponse,
    body: { role },
    signal
  });
}

export function deleteAdminUser({
  accessToken,
  userId,
  signal
}: DeleteAdminUserOptions): Promise<AdminMessageResponse> {
  return requestAdminJson({
    url: buildAdminUserUrl(userId),
    accessToken,
    method: 'DELETE',
    invalidMessage: '強制退会のレスポンス形式が不正です',
    isValidResponse: isAdminMessageResponse,
    signal
  });
}
