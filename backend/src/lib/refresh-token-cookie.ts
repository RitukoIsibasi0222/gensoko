import { deleteCookie } from "hono/cookie";

const REFRESH_TOKEN_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7日（秒）
const REFRESH_TOKEN_COOKIE_NAME = "refreshToken";

/**
 * refreshToken Cookie を発行・削除する auth route の base path を request path から取得する。
 *
 * 例:
 * - /api/v1/auth/login -> /api/v1/auth
 * - /api/v1/users/me  -> /api/v1/auth
 * - /users/me         -> /auth（router 単体テスト用）
 */
export function getRefreshTokenCookieBasePath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const routeIndex = segments.findIndex((segment) => segment === "auth" || segment === "users");
  const prefixSegments = routeIndex === -1 ? [] : segments.slice(0, routeIndex);
  return "/" + [...prefixSegments, "auth"].join("/");
}

export function getRefreshTokenCookiePaths(path: string): readonly [string, string] {
  const authBase = getRefreshTokenCookieBasePath(path);
  return [authBase, authBase + "/refresh"];
}

export function getRefreshTokenCookieOptions(secure: boolean, path: string) {
  return {
    httpOnly: true,
    secure,
    // SEC-006: SameSite=Strict で CSRF 対策を行う（仕様 docs/02_security.md 参照）。
    // SameSite=Strict はクロスサイトリクエストで Cookie が送信されないため、
    // フロントエンドと API は同一 eTLD+1 配下にデプロイする必要がある。
    // （例: gensoko.example.com と api.gensoko.example.com は同一 eTLD+1）
    // SameSite=None に変更すると任意クロスオリジンから Cookie が送れるようになり
    // CSRF 脆弱性が生じるため使用しない。
    sameSite: "Strict" as const,
    path,
    maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
  };
}

export function clearRefreshTokenCookies(
  c: Parameters<typeof deleteCookie>[0],
  requestPath: string,
  secure: boolean,
) {
  for (const path of getRefreshTokenCookiePaths(requestPath)) {
    clearRefreshTokenCookie(c, secure, path);
  }
}

export function clearLegacyRefreshTokenCookie(
  c: Parameters<typeof deleteCookie>[0],
  requestPath: string,
  secure: boolean,
) {
  const [, legacyPath] = getRefreshTokenCookiePaths(requestPath);
  clearRefreshTokenCookie(c, secure, legacyPath);
}

function clearRefreshTokenCookie(
  c: Parameters<typeof deleteCookie>[0],
  secure: boolean,
  path: string,
) {
  const options = getRefreshTokenCookieOptions(secure, path);
  deleteCookie(c, REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: options.httpOnly,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
  });
}
