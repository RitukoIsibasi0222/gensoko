import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { STRONG_PASSWORD_73_BYTES } from "../test/password-byte-boundary-fixtures.js";

describe("bcrypt既存ユーザー互換性", () => {
  it("73バイトの既存パスワードを同じ完全入力で照合できる", async () => {
    expect(bcrypt.truncates(STRONG_PASSWORD_73_BYTES)).toBe(true);
    const passwordHash = await bcrypt.hash(STRONG_PASSWORD_73_BYTES, 4);

    await expect(bcrypt.compare(STRONG_PASSWORD_73_BYTES, passwordHash)).resolves.toBe(true);
  });
});
