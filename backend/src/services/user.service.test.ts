import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    refreshToken: {
      deleteMany: vi.fn(),
    },
    passwordResetToken: {
      deleteMany: vi.fn(),
    },
    emailVerification: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { deleteCurrentUser } from "./user.service.js";

describe("deleteCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("正常系: ユーザーを物理削除せず論理削除する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      passwordHash: "$2b$12$hash",
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

    const txUserUpdate = vi.fn().mockResolvedValue({});
    const txRefreshDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const txPasswordResetDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const txEmailVerificationDeleteMany = vi.fn().mockResolvedValue({ count: 1 });

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: { update: txUserUpdate },
        refreshToken: { deleteMany: txRefreshDeleteMany },
        passwordResetToken: { deleteMany: txPasswordResetDeleteMany },
        emailVerification: { deleteMany: txEmailVerificationDeleteMany },
      } as never);
    });

    await deleteCurrentUser({ userId: "user-1", currentPassword: "Pass1234!" });

    expect(txUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          isActive: false,
          deletedAt: expect.any(Date),
          lockedUntil: null,
        }),
      }),
    );
    expect(txRefreshDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(txPasswordResetDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(txEmailVerificationDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("異常系: パスワード不一致なら UserError(400) を投げる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      passwordHash: "$2b$12$hash",
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

    await expect(
      deleteCurrentUser({ userId: "user-1", currentPassword: "WrongPass1!" }),
    ).rejects.toMatchObject({
      status: 400,
      message: "現在のパスワードが正しくありません",
    });
  });
});
