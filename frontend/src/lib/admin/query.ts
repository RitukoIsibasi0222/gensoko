import type { AdminUserRole, AdminUserStatus, AdminUsersQuery } from '$lib/api/admin';

const ADMIN_SEARCH_MAX_LENGTH = 100;
const ADMIN_SEARCH_LENGTH_ERROR_MESSAGE = '検索キーワードは100文字以内で入力してください';

export type AdminListPageState = {
  q?: string;
  cursor?: string;
};

export type AdminListLocation = {
  query: AdminUsersQuery;
  searchDraft: string;
  canonicalSearchParams: URLSearchParams;
  canonicalPageState: AdminListPageState;
  needsCanonicalization: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAdminUserRole(value: string | null): value is AdminUserRole {
  return value === 'USER' || value === 'ADMIN';
}

function isAdminUserStatus(value: string | null): value is AdminUserStatus {
  return value === 'active' || value === 'suspended';
}

function isCanonicalSearchValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= ADMIN_SEARCH_MAX_LENGTH &&
    value.trim() === value
  );
}

function isCanonicalCursor(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function parseAdminPageState(pageState: unknown): {
  state: AdminListPageState;
  needsCanonicalization: boolean;
} {
  if (pageState === undefined) {
    return { state: {}, needsCanonicalization: false };
  }

  if (!isRecord(pageState)) {
    return { state: {}, needsCanonicalization: true };
  }

  const state: AdminListPageState = {};
  let needsCanonicalization = Object.keys(pageState).some((key) => key !== 'q' && key !== 'cursor');

  if ('q' in pageState) {
    if (isCanonicalSearchValue(pageState.q)) {
      state.q = pageState.q;
    } else {
      needsCanonicalization = true;
    }
  }

  if ('cursor' in pageState) {
    if (isCanonicalCursor(pageState.cursor)) {
      state.cursor = pageState.cursor;
    } else {
      needsCanonicalization = true;
    }
  }

  return { state, needsCanonicalization };
}

function parseAdminUrlQuery(searchParams: URLSearchParams): {
  query: Pick<AdminUsersQuery, 'role' | 'status'>;
  canonicalSearchParams: URLSearchParams;
  needsCanonicalization: boolean;
} {
  const role = searchParams.get('role');
  const status = searchParams.get('status');
  const canonicalSearchParams = new URLSearchParams(searchParams);

  canonicalSearchParams.delete('q');
  canonicalSearchParams.delete('cursor');
  canonicalSearchParams.delete('role');
  canonicalSearchParams.delete('status');

  const query: Pick<AdminUsersQuery, 'role' | 'status'> = {};
  if (isAdminUserRole(role)) {
    query.role = role;
    canonicalSearchParams.set('role', role);
  }
  if (isAdminUserStatus(status)) {
    query.status = status;
    canonicalSearchParams.set('status', status);
  }

  return {
    query,
    canonicalSearchParams,
    needsCanonicalization: canonicalSearchParams.toString() !== searchParams.toString()
  };
}

export function parseAdminListLocation(
  searchParams: URLSearchParams,
  pageState: unknown
): AdminListLocation {
  const parsedUrl = parseAdminUrlQuery(searchParams);
  const parsedPageState = parseAdminPageState(pageState);
  const query: AdminUsersQuery = {};

  if (parsedPageState.state.q) {
    query.q = parsedPageState.state.q;
  }
  if (parsedPageState.state.cursor) {
    query.cursor = parsedPageState.state.cursor;
  }
  if (parsedUrl.query.role) {
    query.role = parsedUrl.query.role;
  }
  if (parsedUrl.query.status) {
    query.status = parsedUrl.query.status;
  }

  return {
    query,
    searchDraft: parsedPageState.state.q ?? '',
    canonicalSearchParams: parsedUrl.canonicalSearchParams,
    canonicalPageState: parsedPageState.state,
    needsCanonicalization: parsedUrl.needsCanonicalization || parsedPageState.needsCanonicalization
  };
}

export function serializeAdminListLocation(input: {
  role?: AdminUserRole;
  status?: AdminUserStatus;
  q?: string;
  cursor?: string;
}): {
  searchParams: URLSearchParams;
  pageState: AdminListPageState;
} {
  const searchParams = new URLSearchParams();
  const pageState: AdminListPageState = {};

  if (input.role) {
    searchParams.set('role', input.role);
  }
  if (input.status) {
    searchParams.set('status', input.status);
  }
  if (input.q) {
    pageState.q = input.q;
  }
  if (input.cursor) {
    pageState.cursor = input.cursor;
  }

  return { searchParams, pageState };
}

export function normalizeAdminSearchInput(
  rawValue: string
): { success: true; value: string | undefined } | { success: false; message: string } {
  const normalizedValue = rawValue.trim();

  if (normalizedValue.length > ADMIN_SEARCH_MAX_LENGTH) {
    return {
      success: false,
      message: ADMIN_SEARCH_LENGTH_ERROR_MESSAGE
    };
  }

  return {
    success: true,
    value: normalizedValue || undefined
  };
}
