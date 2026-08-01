import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(),
    truncates: vi.fn(),
  },
}));

import bcrypt from "bcryptjs";
import { BCRYPT_MAX_PASSWORD_BYTES, hashPassword, PASSWORD_TOO_LONG_MESSAGE } from "./password.js";
import {
  getUtf8ByteLengthForTest,
  STRONG_PASSWORD_BYTE_BOUNDARY_FIXTURES,
} from "../test/password-byte-boundary-fixtures.js";

describe("hashPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(bcrypt.truncates).mockImplementation(
      (password) => getUtf8ByteLengthForTest(password) > BCRYPT_MAX_PASSWORD_BYTES,
    );
  });

  it("bcryptjsをcost 12で1回だけ呼び、生成されたhashを返す", async () => {
    const plainPassword = "SecurePass1!";
    const passwordHash = "$2b$12$generated-password-hash";
    vi.mocked(bcrypt.hash).mockResolvedValue(passwordHash as never);

    await expect(hashPassword(plainPassword)).resolves.toBe(passwordHash);

    expect(bcrypt.hash).toHaveBeenCalledTimes(1);
    expect(bcrypt.hash).toHaveBeenCalledWith(plainPassword, 12);
    expect(passwordHash).not.toBe(plainPassword);
  });

  it("bcryptjsのエラーを握り潰さず呼び出し元へ渡す", async () => {
    const hashError = new Error("bcrypt failed");
    vi.mocked(bcrypt.hash).mockRejectedValue(hashError as never);

    await expect(hashPassword("SecurePass1!")).rejects.toBe(hashError);
  });

  it.each(STRONG_PASSWORD_BYTE_BOUNDARY_FIXTURES)(
    "$nameの72バイトはbcryptへ渡してhashを返す",
    async ({ password72Bytes }) => {
      const passwordHash = "$2b$12$generated-password-hash";
      expect(getUtf8ByteLengthForTest(password72Bytes)).toBe(72);
      vi.mocked(bcrypt.hash).mockResolvedValue(passwordHash as never);

      await expect(hashPassword(password72Bytes)).resolves.toBe(passwordHash);

      expect(bcrypt.truncates).toHaveBeenCalledWith(password72Bytes);
      expect(bcrypt.hash).toHaveBeenCalledWith(password72Bytes, 12);
    },
  );

  it.each(STRONG_PASSWORD_BYTE_BOUNDARY_FIXTURES)(
    "$nameの73バイトは拒否しbcryptを呼ばない",
    async ({ password73Bytes }) => {
      expect(getUtf8ByteLengthForTest(password73Bytes)).toBe(73);

      await expect(hashPassword(password73Bytes)).rejects.toThrow(PASSWORD_TOO_LONG_MESSAGE);

      expect(bcrypt.truncates).toHaveBeenCalledWith(password73Bytes);
      expect(bcrypt.hash).not.toHaveBeenCalled();
    },
  );
});
