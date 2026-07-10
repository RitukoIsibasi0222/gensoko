import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(),
  },
}));

import bcrypt from "bcryptjs";
import { hashPassword } from "./password.js";

describe("hashPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
