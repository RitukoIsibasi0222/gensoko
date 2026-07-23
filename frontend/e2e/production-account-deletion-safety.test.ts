import { describe, expect, it } from 'vitest';

import {
  findIssuedRefreshToken,
  hasIssuedRefreshToken,
  matchesRefreshCookieDeletionContract
} from './production-account-deletion-safety';

const REFRESH_TOKEN = 'a'.repeat(64);
const CURRENT_PATH = '/api/v1/auth';
const LEGACY_PATH = '/api/v1/auth/refresh';

function setCookie(value: string) {
  return { name: 'set-cookie', value };
}

const ISSUED_COOKIE = setCookie(
  `refreshToken=${REFRESH_TOKEN}; Max-Age=604800; Path=${CURRENT_PATH}; HttpOnly; Secure; SameSite=Strict`
);
const CURRENT_DELETION_COOKIE = setCookie(
  `refreshToken=; Max-Age=0; Path=${CURRENT_PATH}; HttpOnly; Secure; SameSite=Strict`
);
const LEGACY_DELETION_COOKIE = setCookie(
  `refreshToken=; Max-Age=0; Path=${LEGACY_PATH}; HttpOnly; Secure; SameSite=Strict`
);

describe('production account deletion Cookie safety contract', () => {
  it('現行Pathへ安全属性付きで発行された64桁hex refresh tokenを1本だけ返す', () => {
    expect(findIssuedRefreshToken([ISSUED_COOKIE, LEGACY_DELETION_COOKIE], CURRENT_PATH)).toBe(
      REFRESH_TOKEN
    );
  });

  it.each([
    [[], 'Cookieなし'],
    [[LEGACY_DELETION_COOKIE], '削除Cookieだけ'],
    [
      [
        ISSUED_COOKIE,
        setCookie(
          `refreshToken=${'b'.repeat(64)}; Max-Age=604800; Path=${CURRENT_PATH}; HttpOnly; Secure; SameSite=Strict`
        )
      ],
      '発行tokenが複数'
    ],
    [
      [
        setCookie(
          `refreshToken=${REFRESH_TOKEN}; Max-Age=604800; Path=${LEGACY_PATH}; HttpOnly; Secure; SameSite=Strict`
        )
      ],
      'legacy Pathへ発行'
    ],
    [
      [
        setCookie(
          `refreshToken=${REFRESH_TOKEN}; Max-Age=604800; Path=${CURRENT_PATH}; HttpOnly; SameSite=Strict`
        )
      ],
      'Secureなし'
    ],
    [
      [
        setCookie(
          `refreshToken=short; Max-Age=604800; Path=${CURRENT_PATH}; HttpOnly; Secure; SameSite=Strict`
        )
      ],
      'token形式不正'
    ]
  ])('%sは発行済みrefresh tokenとして受理しない: %s', (headers) => {
    expect(findIssuedRefreshToken(headers, CURRENT_PATH)).toBeNull();
  });

  it('現行・legacy両Pathの安全な削除Cookieだけを削除契約として受理する', () => {
    expect(
      matchesRefreshCookieDeletionContract(
        [CURRENT_DELETION_COOKIE, LEGACY_DELETION_COOKIE],
        [CURRENT_PATH, LEGACY_PATH]
      )
    ).toBe(true);
  });

  it.each([
    [[CURRENT_DELETION_COOKIE], 'legacy Pathなし'],
    [
      [
        CURRENT_DELETION_COOKIE,
        setCookie(
          `refreshToken=value; Max-Age=604800; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Path=${LEGACY_PATH}; HttpOnly; Secure; SameSite=Strict`
        ),
        setCookie('other=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/')
      ],
      'future refresh Cookieと別Cookieの期限切れmarker'
    ],
    [
      [
        CURRENT_DELETION_COOKIE,
        setCookie(`refreshToken=; Max-Age=0; Path=${LEGACY_PATH}; Secure; SameSite=Strict`)
      ],
      'HttpOnlyなし'
    ],
    [
      [
        CURRENT_DELETION_COOKIE,
        setCookie(`refreshToken=; Max-Age=0; Path=${LEGACY_PATH}; HttpOnly; Secure; SameSite=Lax`)
      ],
      'SameSite不一致'
    ]
  ])('%sは削除契約として受理しない: %s', (headers) => {
    expect(matchesRefreshCookieDeletionContract(headers, [CURRENT_PATH, LEGACY_PATH])).toBe(false);
  });

  it('空値の削除Cookieは新しいrefresh token発行として扱わない', () => {
    expect(hasIssuedRefreshToken([CURRENT_DELETION_COOKIE, LEGACY_DELETION_COOKIE])).toBe(false);
    expect(hasIssuedRefreshToken([CURRENT_DELETION_COOKIE, ISSUED_COOKIE])).toBe(true);
  });
});
