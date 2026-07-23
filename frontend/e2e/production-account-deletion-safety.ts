export type ResponseHeader = Readonly<{
  name: string;
  value: string;
}>;

type ParsedRefreshCookie = Readonly<{
  value: string;
  path: string | null;
  maxAge: string | null;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | null;
}>;

const REFRESH_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const REFRESH_TOKEN_MAX_AGE = '604800';

function parseRefreshCookie(header: ResponseHeader): ParsedRefreshCookie | null {
  if (header.name.toLowerCase() !== 'set-cookie') {
    return null;
  }

  const parts = header.value.split(';').map((part) => part.trim());
  const cookiePair = parts.shift() ?? '';
  const separatorIndex = cookiePair.indexOf('=');
  if (separatorIndex === -1 || cookiePair.slice(0, separatorIndex) !== 'refreshToken') {
    return null;
  }

  let path: string | null = null;
  let maxAge: string | null = null;
  let httpOnly = false;
  let secure = false;
  let sameSite: string | null = null;

  for (const part of parts) {
    const attributeSeparatorIndex = part.indexOf('=');
    const attributeName = (
      attributeSeparatorIndex === -1 ? part : part.slice(0, attributeSeparatorIndex)
    ).toLowerCase();
    const attributeValue =
      attributeSeparatorIndex === -1 ? '' : part.slice(attributeSeparatorIndex + 1);

    if (attributeName === 'path') path = attributeValue;
    if (attributeName === 'max-age') maxAge = attributeValue;
    if (attributeName === 'httponly') httpOnly = true;
    if (attributeName === 'secure') secure = true;
    if (attributeName === 'samesite') sameSite = attributeValue.toLowerCase();
  }

  return {
    value: cookiePair.slice(separatorIndex + 1),
    path,
    maxAge,
    httpOnly,
    secure,
    sameSite
  };
}

function isSecureRefreshCookie(cookie: ParsedRefreshCookie): boolean {
  return cookie.httpOnly && cookie.secure && cookie.sameSite === 'strict';
}

export function findIssuedRefreshToken(
  headers: readonly ResponseHeader[],
  expectedPath: string
): string | null {
  const issuedCookies = headers
    .map(parseRefreshCookie)
    .filter(
      (cookie): cookie is ParsedRefreshCookie =>
        cookie !== null &&
        REFRESH_TOKEN_PATTERN.test(cookie.value) &&
        cookie.path === expectedPath &&
        cookie.maxAge === REFRESH_TOKEN_MAX_AGE &&
        isSecureRefreshCookie(cookie)
    );

  return issuedCookies.length === 1 ? issuedCookies[0].value : null;
}

export function matchesRefreshCookieDeletionContract(
  headers: readonly ResponseHeader[],
  expectedPaths: readonly string[]
): boolean {
  const refreshCookies = headers
    .map(parseRefreshCookie)
    .filter((cookie): cookie is ParsedRefreshCookie => cookie !== null);

  return (
    new Set(expectedPaths).size === expectedPaths.length &&
    refreshCookies.length === expectedPaths.length &&
    expectedPaths.every((path) =>
      refreshCookies.some(
        (cookie) =>
          cookie.value === '' &&
          cookie.path === path &&
          cookie.maxAge === '0' &&
          isSecureRefreshCookie(cookie)
      )
    )
  );
}

export function hasIssuedRefreshToken(headers: readonly ResponseHeader[]): boolean {
  return headers
    .map(parseRefreshCookie)
    .some((cookie) => cookie !== null && cookie.value.length > 0);
}
