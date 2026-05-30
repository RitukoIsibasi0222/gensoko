import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
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
import {
  changeCurrentPassword,
  deleteCurrentUser,
  getCurrentUserProfile,
  updateCurrentUsername,
} from "./user.service.js";

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

describe("updateCurrentUsername", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("異常系: DBのユニーク制約違反(P2002)をUserError(409)に変換する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      username: "old_name",
      role: "USER",
    } as never);

    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.user.update).mockRejectedValue({ code: "P2002" } as never);

    await expect(
      updateCurrentUsername({ userId: "user-1", username: "new_name" }),
    ).rejects.toMatchObject({
      status: 409,
      message: "このユーザー名は既に使用されています",
    });
  });
});

describe("changeCurrentPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("正常系: 現在のパスワードが正しければ update と deleteMany が呼ばれる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      passwordHash: "$2b$12$hash",
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(bcrypt.hash).mockResolvedValue("$2b$12$newhash" as never);

    const txUserUpdate = vi.fn().mockResolvedValue({});
    const txRefreshDeleteMany = vi.fn().mockResolvedValue({ count: 1 });

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: { update: txUserUpdate },
        refreshToken: { deleteMany: txRefreshDeleteMany },
      } as never);
    });

    await changeCurrentPassword({
      userId: "user-1",
      currentPassword: "OldPass1!",
      newPassword: "NewPass1!",
    });

    expect(txUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { passwordHash: "$2b$12$newhash" },
      }),
    );
    expect(txRefreshDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("異常系: 新旧パスワードが同一なら UserError(400) を投げる", async () => {
    await expect(
      changeCurrentPassword({
        userId: "user-1",
        currentPassword: "SamePass1!",
        newPassword: "SamePass1!",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "新しいパスワードは現在のパスワードと異なるものにしてください",
    });
  });

  it("異常系: 現在のパスワードが不一致なら UserError(400) を投げる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      passwordHash: "$2b$12$hash",
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

    await expect(
      changeCurrentPassword({
        userId: "user-1",
        currentPassword: "WrongPass1!",
        newPassword: "NewPass1!",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "現在のパスワードが正しくありません",
    });
  });
});

describe("getCurrentUserProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("正常系: ユーザーが見つかればプロフィールを返す", async () => {
    const mockUser = {
      id: "user-1",
      username: "testuser",
      email: "test@example.com",
      role: "USER" as const,
      createdAt: new Date("2026-01-01"),
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

    const result = await getCurrentUserProfile("user-1");

    expect(result).toEqual(mockUser);
  });

  it("異常系: ユーザーが見つからなければ UserError(403) を投げる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    await expect(getCurrentUserProfile("user-1")).rejects.toMatchObject({
      status: 403,
      message: "ユーザーが見つかりません",
    });
  });
});
