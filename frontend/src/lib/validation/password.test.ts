import { describe, expect, it } from 'vitest';
import {
  getUtf8ByteLengthForTest,
  STRONG_PASSWORD_BYTE_BOUNDARY_FIXTURES
} from '$lib/test/password-byte-boundary-fixtures';
import {
  getUtf8ByteLength,
  MAX_PASSWORD_UTF8_BYTES,
  PASSWORD_TOO_LONG_MESSAGE,
  validatePassword
} from './password';

describe('validatePassword bcrypt 72バイト境界', () => {
  it('上限定数はbcrypt仕様の72バイトである', () => {
    expect(MAX_PASSWORD_UTF8_BYTES).toBe(72);
  });

  it.each(STRONG_PASSWORD_BYTE_BOUNDARY_FIXTURES)(
    '$nameは72バイトを受理し73バイトを共通メッセージで拒否する',
    ({ password72Bytes, password73Bytes }) => {
      expect(getUtf8ByteLengthForTest(password72Bytes)).toBe(72);
      expect(getUtf8ByteLength(password72Bytes)).toBe(72);
      expect(validatePassword(password72Bytes)).toBeNull();
      expect(getUtf8ByteLengthForTest(password73Bytes)).toBe(73);
      expect(getUtf8ByteLength(password73Bytes)).toBe(73);

      expect(validatePassword(password73Bytes)).toBe(PASSWORD_TOO_LONG_MESSAGE);
    }
  );
});
