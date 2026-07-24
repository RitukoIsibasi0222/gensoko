import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBcryptPasswordVerifier } from "./bcrypt-password-verifier.js";
import { PasswordVerificationUnavailableError } from "./password-verifier.js";

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
  },
}));

const INPUT = {
  userId: "account-internal-id",
  password: "Pass1234!",
  passwordHash: "$2b$12$existinghash",
} as const;

describe("createBcryptPasswordVerifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([true, false])("bcryptのstrict boolean結果 %s を返す", async (result) => {
    vi.mocked(bcrypt.compare).mockResolvedValue(result as never);

    await expect(createBcryptPasswordVerifier().verify(INPUT)).resolves.toBe(result);
    expect(bcrypt.compare).toHaveBeenCalledOnce();
    expect(bcrypt.compare).toHaveBeenCalledWith(INPUT.password, INPUT.passwordHash);
  });

  it("bcrypt exceptionをraw causeなしの固定unavailable errorへ縮約する", async () => {
    vi.mocked(bcrypt.compare).mockRejectedValue(new Error("sensitive bcrypt failure"));

    const error = await createBcryptPasswordVerifier()
      .verify(INPUT)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(PasswordVerificationUnavailableError);
    expect(error).toMatchObject({
      name: "PasswordVerificationUnavailableError",
      message: "パスワード照合を利用できません",
    });
    expect(error).not.toHaveProperty("cause");
    expect(String(error)).not.toContain("sensitive");
  });
});
