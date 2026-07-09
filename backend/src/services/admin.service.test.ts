import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    userStats: {
      aggregate: vi.fn(),
    },
    gameSession: {
      count: vi.fn(),
    },
    weakElement: {
      count: vi.fn(),
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

import { prisma } from "../lib/prisma.js";
import {
  AdminServiceError,
  forceDeleteAdminUser,
  getAdminStats,
  getAdminUserDetail,
  getAdminUsers,
  updateAdminUserRole,
  updateAdminUserStatus,
} from "./admin.service.js";

const NOW = new Date("2026-07-09T12:00:00.000Z");
const BASE_DATE = new Date("2026-06-20T12:00:00.000Z");

function createSerializationConflictError() {
  return new Prisma.PrismaClientKnownRequestError("Transaction write conflict", {
    code: "P2034",
    clientVersion: "test",
  });
}

const baseAdminUser = {
  id: "admin-1",
  username: "admin",
  email: "admin@example.com",
  role: "ADMIN" as const,
  emailVerified: true,
  isActive: true,
  deletedAt: null,
  loginFailCount: 0,
  lockedUntil: null,
  lastLoginAt: BASE_DATE,
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
};

const baseTargetUser = {
  id: "user-1",
  username: "taro123",
  email: "taro@example.com",
  role: "USER" as const,
  emailVerified: true,
  isActive: true,
  deletedAt: null,
  loginFailCount: 0,
  lockedUntil: null,
  lastLoginAt: BASE_DATE,
  createdAt: BASE_DATE,
  updatedAt: BASE_DATE,
};

const baseStats = {
  totalGames: 12,
  totalCorrect: 50,
  totalAnswered: 60,
  masteredCount: 18,
  currentStreak: 4,
  weeklyScore: 1200,
  allTimeScore: 5400,
  lastActiveDate: BASE_DATE,
  updatedAt: BASE_DATE,
};

function createUser(overrides: Partial<typeof baseTargetUser> = {}) {
  return {
    ...baseTargetUser,
    stats: baseStats,
    ...overrides,
  };
}

function mockTransaction() {
  const tx = {
    user: {
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    refreshToken: { deleteMany: vi.fn() },
    passwordResetToken: { deleteMany: vi.fn() },
    emailVerification: { deleteMany: vi.fn() },
  };

  vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as never));

  return tx;
}

describe("getAdminUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("query を正規化し、role/status/q/cursor を反映して limit+1 件を取得する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "cursor-user",
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
    } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      createUser({ id: "user-2", createdAt: new Date("2026-06-19T00:00:00.000Z") }),
      createUser({ id: "user-1", createdAt: new Date("2026-06-18T00:00:00.000Z") }),
      createUser({ id: "extra", createdAt: new Date("2026-06-17T00:00:00.000Z") }),
    ] as never);

    const result = await getAdminUsers({
      limit: 2,
      cursor: " cursor-user ",
      q: " taro ",
      role: "USER",
      status: "active",
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "cursor-user" },
      select: { id: true, createdAt: true },
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        where: expect.objectContaining({
          role: "USER",
          isActive: true,
          deletedAt: null,
          OR: [{ username: { contains: "taro" } }, { email: { contains: "taro" } }],
          AND: [
            {
              OR: [
                { createdAt: { lt: new Date("2026-06-20T00:00:00.000Z") } },
                {
                  createdAt: new Date("2026-06-20T00:00:00.000Z"),
                  id: { lt: "cursor-user" },
                },
              ],
            },
          ],
        }),
      }),
    );
    expect(result.nextCursor).toBe("user-1");
    expect(result.users).toHaveLength(2);
    expect(result.users[0].stats.accuracyRate).toBe(83);
  });

  it("cursor が存在しない場合は AdminServiceError(400) を投げる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    await expect(getAdminUsers({ limit: 20, cursor: "missing" })).rejects.toMatchObject({
      status: 400,
      message: "カーソルが正しくありません",
    });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});

describe("getAdminUserDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("対象ユーザーの詳細と統計を返し、機密フィールドを含めない", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(createUser() as never);

    const result = await getAdminUserDetail({ userId: " user-1 " });

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        select: expect.not.objectContaining({ passwordHash: true }),
      }),
    );
    expect(result.user.stats.accuracyRate).toBe(83);
    expect(result.user).not.toHaveProperty("passwordHash");
  });

  it("対象ユーザーが存在しない場合は AdminServiceError(404) を投げる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    await expect(getAdminUserDetail({ userId: "missing" })).rejects.toMatchObject({
      status: 404,
      message: "ユーザーが見つかりません",
    });
  });
});

describe("updateAdminUserStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("停止時は transaction 内で状態更新と全 token 削除を行う", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValue({ ...baseTargetUser, role: "USER" });
    tx.user.update.mockResolvedValue({ ...baseTargetUser, isActive: false });

    const result = await updateAdminUserStatus({
      adminUserId: "admin-1",
      targetUserId: " user-1 ",
      isActive: false,
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { isActive: false, lockedUntil: null },
      }),
    );
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(tx.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(tx.emailVerification.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(result.message).toBe("アカウントを停止しました");
  });

  it("自分自身の停止/解除は AdminServiceError(409) にする", async () => {
    await expect(
      updateAdminUserStatus({ adminUserId: " admin-1 ", targetUserId: "admin-1", isActive: false }),
    ).rejects.toMatchObject({
      status: 409,
      message: "自分自身には実行できません",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("最後の利用可能な管理者を停止しようとしたら AdminServiceError(409) にする", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValue({ ...baseAdminUser, id: "admin-2" });
    tx.user.count.mockResolvedValue(1);

    await expect(
      updateAdminUserStatus({ adminUserId: "admin-1", targetUserId: "admin-2", isActive: false }),
    ).rejects.toMatchObject({
      status: 409,
      message: "最後の管理者は変更できません",
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("serializable transaction の競合が続いた場合は AdminServiceError(409) にする", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(createSerializationConflictError());

    await expect(
      updateAdminUserStatus({ adminUserId: "admin-1", targetUserId: "admin-2", isActive: false }),
    ).rejects.toMatchObject({
      status: 409,
      message: "同時操作により処理できませんでした。再試行してください",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});

describe("updateAdminUserRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("有効でメール認証済みのユーザーを ADMIN に昇格する", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValue(baseTargetUser);
    tx.user.update.mockResolvedValue({ ...baseTargetUser, role: "ADMIN" });

    const result = await updateAdminUserRole({
      adminUserId: "admin-1",
      targetUserId: "user-1",
      role: "ADMIN",
    });

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { role: "ADMIN" },
      }),
    );
    expect(tx.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(result.user.role).toBe("ADMIN");
  });

  it("adminUserId を正規化して自分自身のロール変更を拒否する", async () => {
    await expect(
      updateAdminUserRole({ adminUserId: " admin-1 ", targetUserId: "admin-1", role: "USER" }),
    ).rejects.toMatchObject({
      status: 409,
      message: "自分自身には実行できません",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("メール未認証ユーザーの ADMIN 昇格は AdminServiceError(409) にする", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValue({ ...baseTargetUser, emailVerified: false });

    await expect(
      updateAdminUserRole({ adminUserId: "admin-1", targetUserId: "user-1", role: "ADMIN" }),
    ).rejects.toMatchObject({
      status: 409,
      message: "メール認証済みで有効なユーザーのみ管理者にできます",
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("最後の利用可能な管理者を USER に降格しようとしたら AdminServiceError(409) にする", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValue({ ...baseAdminUser, id: "admin-2" });
    tx.user.count.mockResolvedValue(1);

    await expect(
      updateAdminUserRole({ adminUserId: "admin-1", targetUserId: "admin-2", role: "USER" }),
    ).rejects.toMatchObject({
      status: 409,
      message: "最後の管理者は変更できません",
    });
  });
});

describe("forceDeleteAdminUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it("対象ユーザーを物理削除せず soft delete し、全 token を削除する", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValue(baseTargetUser);
    tx.user.update.mockResolvedValue({ ...baseTargetUser, isActive: false, deletedAt: NOW });

    const result = await forceDeleteAdminUser({ adminUserId: "admin-1", targetUserId: "user-1" });

    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { isActive: false, deletedAt: NOW, lockedUntil: null },
      }),
    );
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(tx.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(tx.emailVerification.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(result).toEqual({ message: "ユーザーを強制退会しました" });
  });

  it("adminUserId を正規化して自分自身の強制退会を拒否する", async () => {
    await expect(
      forceDeleteAdminUser({ adminUserId: " admin-1 ", targetUserId: "admin-1" }),
    ).rejects.toMatchObject({
      status: 409,
      message: "自分自身には実行できません",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("既に削除済みのユーザーは AdminServiceError(409) にする", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValue({ ...baseTargetUser, deletedAt: BASE_DATE });

    await expect(
      forceDeleteAdminUser({ adminUserId: "admin-1", targetUserId: "user-1" }),
    ).rejects.toMatchObject({
      status: 409,
      message: "ユーザーは既に削除されています",
    });
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});

describe("getAdminStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("UserStats aggregate を中心にサービス統計を返す", async () => {
    vi.mocked(prisma.user.count)
      .mockResolvedValueOnce(100 as never)
      .mockResolvedValueOnce(90 as never)
      .mockResolvedValueOnce(5 as never)
      .mockResolvedValueOnce(5 as never)
      .mockResolvedValueOnce(2 as never)
      .mockResolvedValueOnce(80 as never);
    vi.mocked(prisma.gameSession.count).mockResolvedValue(320 as never);
    vi.mocked(prisma.weakElement.count).mockResolvedValue(45 as never);
    vi.mocked(prisma.userStats.aggregate).mockResolvedValue({
      _sum: {
        totalAnswered: 3200,
        totalCorrect: 2496,
        masteredCount: 250,
      },
    } as never);

    const result = await getAdminStats();

    expect(result).toEqual({
      users: {
        total: 100,
        active: 90,
        suspended: 5,
        deleted: 5,
        admins: 2,
        emailVerified: 80,
      },
      games: {
        totalSessions: 320,
        totalAnswered: 3200,
        averageAccuracyRate: 78,
      },
      learning: {
        totalWeakElements: 45,
        totalMasteredCount: 250,
      },
    });
    expect(prisma.userStats.aggregate).toHaveBeenCalledWith({
      _sum: { totalAnswered: true, totalCorrect: true, masteredCount: true },
    });
  });
});

describe("AdminServiceError", () => {
  it("HTTP status と日本語メッセージを保持する", () => {
    const error = new AdminServiceError(409, "最後の管理者は変更できません");

    expect(error.status).toBe(409);
    expect(error.message).toBe("最後の管理者は変更できません");
  });
});
