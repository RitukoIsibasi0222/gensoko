import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    userStats: {
      findUnique: vi.fn(),
    },
    gameSession: {
      findMany: vi.fn(),
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
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("bcryptjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcryptjs")>();
  return {
    default: {
      ...actual.default,
      compare: vi.fn(),
      hash: vi.fn(),
    },
  };
});

import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import {
  STRONG_PASSWORD_72_BYTES,
  STRONG_PASSWORD_73_BYTES,
} from "../test/password-byte-boundary-fixtures.js";
import {
  changeCurrentPassword,
  deleteCurrentUser,
  getCurrentUserProfile,
  getCurrentUserStats,
  updateCurrentUsername,
} from "./user.service.js";

const NOW = new Date("2026-06-20T12:00:00.000Z");
const WEEK_START = new Date("2026-06-14T15:00:00.000Z");

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

  it("既存互換性: 73バイトのcurrentPasswordを完全な値で照合する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      passwordHash: "$2b$12$hash",
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

    await expect(
      deleteCurrentUser({ userId: "user-1", currentPassword: STRONG_PASSWORD_73_BYTES }),
    ).rejects.toMatchObject({
      status: 400,
      message: "現在のパスワードが正しくありません",
    });
    expect(bcrypt.compare).toHaveBeenCalledWith(STRONG_PASSWORD_73_BYTES, "$2b$12$hash");
  });
});

describe("updateCurrentUsername", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("trim後のユーザー名が同じ場合は更新せず現在のユーザーを返す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      username: "same_name",
      role: "USER",
    } as never);

    const result = await updateCurrentUsername({ userId: "user-1", username: " same_name " });

    expect(result).toEqual({
      user: { id: "user-1", username: "same_name", role: "USER" },
    });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("重複確認と更新にはtrim後のユーザー名を使う", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      username: "old_name",
      role: "USER",
    } as never);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: "user-1",
      username: "new_name",
      role: "USER",
    } as never);

    const result = await updateCurrentUsername({ userId: "user-1", username: " new_name " });

    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        username: "new_name",
        id: { not: "user-1" },
      },
      select: { id: true },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { username: "new_name" },
      select: { id: true, username: true, role: true },
    });
    expect(result).toEqual({
      user: { id: "user-1", username: "new_name", role: "USER" },
    });
  });

  it("ユーザーが存在しない場合はUserError(403)を投げる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    await expect(
      updateCurrentUsername({ userId: "missing-user", username: "new_name" }),
    ).rejects.toMatchObject({
      status: 403,
      message: "ユーザーが見つかりません",
    });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
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
    vi.mocked(bcrypt.compare).mockReset();
    vi.mocked(bcrypt.hash).mockReset();
    vi.mocked(prisma.$transaction).mockReset();
  });

  it("正常系: 現在のパスワードが正しければ update と deleteMany が呼ばれる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      passwordHash: "$2b$12$hash",
      role: "USER",
    } as never);
    vi.mocked(bcrypt.compare)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(false as never);
    vi.mocked(bcrypt.hash).mockResolvedValue("$2b$12$newhash" as never);

    const txUserUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txRefreshDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const txAuditLogCreate = vi.fn().mockResolvedValue({});

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: { updateMany: txUserUpdateMany },
        refreshToken: { deleteMany: txRefreshDeleteMany },
        auditLog: { create: txAuditLogCreate },
      } as never);
    });

    await changeCurrentPassword({
      userId: "user-1",
      currentPassword: "OldPass1!",
      newPassword: "NewPass1!",
    });

    expect(txUserUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "user-1",
          passwordHash: "$2b$12$hash",
        },
        data: { passwordHash: "$2b$12$newhash" },
      }),
    );
    expect(txRefreshDeleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    expect(txAuditLogCreate).toHaveBeenCalledWith({
      data: {
        action: "PASSWORD_CHANGE",
        result: "SUCCESS",
        actorId: "user-1",
        actorRole: "USER",
        targetType: "USER",
        targetId: "user-1",
        failureReason: null,
      },
    });
    expect(txAuditLogCreate).toHaveBeenCalledTimes(1);
  });

  it("監査: 保存失敗時はパスワード変更処理全体を失敗させる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      passwordHash: "$2b$12$hash",
      role: "USER",
    } as never);
    vi.mocked(bcrypt.compare)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(false as never);
    vi.mocked(bcrypt.hash).mockResolvedValue("$2b$12$newhash" as never);

    const txUserUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const txRefreshDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const txAuditLogCreate = vi.fn().mockRejectedValue(new Error("audit insert failed"));

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: { updateMany: txUserUpdateMany },
        refreshToken: { deleteMany: txRefreshDeleteMany },
        auditLog: { create: txAuditLogCreate },
      } as never);
    });

    await expect(
      changeCurrentPassword({
        userId: "user-1",
        currentPassword: "OldPass1!",
        newPassword: "NewPass1!",
      }),
    ).rejects.toThrow("audit insert failed");

    expect(txUserUpdateMany).toHaveBeenCalledOnce();
    expect(txRefreshDeleteMany).toHaveBeenCalledOnce();
    expect(txAuditLogCreate).toHaveBeenCalledOnce();
  });

  it("競合系: 照合後にパスワードが変更済みなら409で副作用を開始しない", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      passwordHash: "$2b$12$oldhash",
      role: "USER",
    } as never);
    vi.mocked(bcrypt.compare)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(false as never);
    vi.mocked(bcrypt.hash).mockResolvedValue("$2b$12$newhash" as never);

    const txUserUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const txRefreshDeleteMany = vi.fn();
    const txAuditLogCreate = vi.fn();

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: { updateMany: txUserUpdateMany },
        refreshToken: { deleteMany: txRefreshDeleteMany },
        auditLog: { create: txAuditLogCreate },
      } as never);
    });

    await expect(
      changeCurrentPassword({
        userId: "user-1",
        currentPassword: "OldPass1!",
        newPassword: "NewPass1!",
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "パスワードが既に変更されています。再ログインしてください",
    });

    expect(txUserUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        passwordHash: "$2b$12$oldhash",
      },
      data: { passwordHash: "$2b$12$newhash" },
    });
    expect(txRefreshDeleteMany).not.toHaveBeenCalled();
    expect(txAuditLogCreate).not.toHaveBeenCalled();
  });

  it("異常系: 新旧パスワードが同一なら UserError(400) を投げる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      passwordHash: "$2b$12$hash",
      role: "USER",
    } as never);
    vi.mocked(bcrypt.compare)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(true as never);

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
    expect(bcrypt.compare).toHaveBeenNthCalledWith(1, "SamePass1!", "$2b$12$hash");
    expect(bcrypt.compare).toHaveBeenNthCalledWith(2, "SamePass1!", "$2b$12$hash");
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("現在と新規の文字列が同じでも現在パスワード不一致を先に返す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      passwordHash: "$2b$12$hash",
      role: "USER",
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

    await expect(
      changeCurrentPassword({
        userId: "user-1",
        currentPassword: "WrongPass1!",
        newPassword: "WrongPass1!",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "現在のパスワードが正しくありません",
    });
    expect(bcrypt.compare).toHaveBeenCalledOnce();
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("既存73バイト値の先頭72バイトへの変更はbcrypt上同一として拒否する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      passwordHash: "$2b$12$legacy-hash",
      role: "USER",
    } as never);
    vi.mocked(bcrypt.compare)
      .mockResolvedValueOnce(true as never)
      .mockResolvedValueOnce(true as never);
    vi.mocked(bcrypt.hash).mockResolvedValue("$2b$12$newhash" as never);
    vi.mocked(prisma.$transaction).mockResolvedValue(undefined as never);

    await expect(
      changeCurrentPassword({
        userId: "user-1",
        currentPassword: STRONG_PASSWORD_73_BYTES,
        newPassword: STRONG_PASSWORD_72_BYTES,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "新しいパスワードは現在のパスワードと異なるものにしてください",
    });
    expect(bcrypt.compare).toHaveBeenNthCalledWith(
      1,
      STRONG_PASSWORD_73_BYTES,
      "$2b$12$legacy-hash",
    );
    expect(bcrypt.compare).toHaveBeenNthCalledWith(
      2,
      STRONG_PASSWORD_72_BYTES,
      "$2b$12$legacy-hash",
    );
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
    expect(bcrypt.compare).toHaveBeenCalledOnce();
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("既存互換性: 73バイトのcurrentPasswordを完全な値で照合する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      passwordHash: "$2b$12$hash",
      role: "USER",
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

    await expect(
      changeCurrentPassword({
        userId: "user-1",
        currentPassword: STRONG_PASSWORD_73_BYTES,
        newPassword: "NewPass1!",
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "現在のパスワードが正しくありません",
    });
    expect(bcrypt.compare).toHaveBeenCalledWith(STRONG_PASSWORD_73_BYTES, "$2b$12$hash");
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

describe("getCurrentUserStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("正常系: 不整合な正解数でも正答率を 0 から 100 に丸める", async () => {
    const playedAt = new Date("2026-06-20T12:35:00.000Z");

    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue({
      totalGames: 1,
      totalCorrect: 12,
      totalAnswered: 10,
      masteredCount: 0,
      currentStreak: 1,
      weeklyScore: 0,
      weeklyScoreWeekStart: WEEK_START,
      allTimeScore: 0,
      lastActiveDate: null,
      updatedAt: playedAt,
    } as never);
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([
      {
        id: "session-1",
        playedAt,
        correctCount: 12,
        totalCount: 10,
      },
    ] as never);

    const result = await getCurrentUserStats("user-1");

    expect(result.stats.totalCorrect).toBe(10);
    expect(result.stats.totalAnswered).toBe(10);
    expect(result.stats.averageAccuracyRate).toBe(100);
    expect(result.recentAccuracyTrend[0]).toMatchObject({
      correctCount: 10,
      totalCount: 10,
      accuracyRate: 100,
    });
  });

  it("正常系: 負の統計値はレスポンスで 0 に丸める", async () => {
    const playedAt = new Date("2026-06-20T12:35:00.000Z");

    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue({
      totalGames: -1,
      totalCorrect: -3,
      totalAnswered: -2,
      masteredCount: -4,
      currentStreak: -5,
      weeklyScore: -6,
      weeklyScoreWeekStart: WEEK_START,
      allTimeScore: -7,
      lastActiveDate: null,
      updatedAt: playedAt,
    } as never);
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([
      {
        id: "session-1",
        playedAt,
        correctCount: -1,
        totalCount: -10,
      },
    ] as never);

    const result = await getCurrentUserStats("user-1");

    expect(result.stats).toMatchObject({
      totalGames: 0,
      totalCorrect: 0,
      totalAnswered: 0,
      averageAccuracyRate: 0,
      masteredCount: 0,
      currentStreak: 0,
      weeklyScore: 0,
      allTimeScore: 0,
    });
    expect(result.recentAccuracyTrend[0]).toMatchObject({
      correctCount: 0,
      totalCount: 0,
      accuracyRate: 0,
    });
  });

  it("正常系: ユーザー統計と直近10件の正答率推移を返す", async () => {
    const statsUpdatedAt = new Date("2026-06-20T12:35:00.000Z");
    const lastActiveDate = new Date("2026-06-20T00:00:00.000Z");
    const recentSessions = [
      {
        id: "session-new",
        playedAt: new Date("2026-06-20T12:35:00.000Z"),
        correctCount: 8,
        totalCount: 10,
      },
      {
        id: "session-old",
        playedAt: new Date("2026-06-19T12:35:00.000Z"),
        correctCount: 5,
        totalCount: 10,
      },
    ];

    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue({
      userId: "user-1",
      totalGames: 12,
      totalCorrect: 91,
      totalAnswered: 120,
      masteredCount: 18,
      currentStreak: 5,
      weeklyScore: 2400,
      weeklyScoreWeekStart: WEEK_START,
      allTimeScore: 9200,
      lastActiveDate,
      updatedAt: statsUpdatedAt,
    } as never);
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue(recentSessions as never);

    const result = await getCurrentUserStats("user-1");

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { id: true },
    });
    expect(prisma.userStats.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: {
        totalGames: true,
        totalCorrect: true,
        totalAnswered: true,
        masteredCount: true,
        currentStreak: true,
        weeklyScore: true,
        weeklyScoreWeekStart: true,
        allTimeScore: true,
        lastActiveDate: true,
        updatedAt: true,
      },
    });
    expect(prisma.gameSession.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: [{ playedAt: "desc" }, { id: "desc" }],
      take: 10,
      select: {
        id: true,
        playedAt: true,
        correctCount: true,
        totalCount: true,
      },
    });
    expect(result).toEqual({
      stats: {
        totalGames: 12,
        totalCorrect: 91,
        totalAnswered: 120,
        averageAccuracyRate: 76,
        masteredCount: 18,
        currentStreak: 5,
        weeklyScore: 2400,
        allTimeScore: 9200,
        lastActiveDate,
        updatedAt: statsUpdatedAt,
      },
      recentAccuracyTrend: [
        {
          sessionId: "session-old",
          playedAt: new Date("2026-06-19T12:35:00.000Z"),
          correctCount: 5,
          totalCount: 10,
          accuracyRate: 50,
        },
        {
          sessionId: "session-new",
          playedAt: new Date("2026-06-20T12:35:00.000Z"),
          correctCount: 8,
          totalCount: 10,
          accuracyRate: 80,
        },
      ],
    });
  });

  it("正常系: ユーザー統計が未作成ならゼロ値と空の推移を返す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([] as never);

    await expect(getCurrentUserStats("user-1")).resolves.toEqual({
      stats: {
        totalGames: 0,
        totalCorrect: 0,
        totalAnswered: 0,
        averageAccuracyRate: 0,
        masteredCount: 0,
        currentStreak: 0,
        weeklyScore: 0,
        allTimeScore: 0,
        lastActiveDate: null,
        updatedAt: null,
      },
      recentAccuracyTrend: [],
    });
  });

  it("正常系: totalAnswered が 0 の場合は平均正答率を 0 にする", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue({
      totalGames: 1,
      totalCorrect: 0,
      totalAnswered: 0,
      masteredCount: 0,
      currentStreak: 1,
      weeklyScore: 0,
      allTimeScore: 0,
      lastActiveDate: null,
      updatedAt: new Date("2026-06-20T12:35:00.000Z"),
    } as never);
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([] as never);

    const result = await getCurrentUserStats("user-1");

    expect(result.stats.averageAccuracyRate).toBe(0);
  });

  it("異常系: ユーザーが見つからなければ UserError(403) を投げる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    await expect(getCurrentUserStats("missing-user")).rejects.toMatchObject({
      status: 403,
      message: "ユーザーが見つかりません",
    });
    expect(prisma.userStats.findUnique).not.toHaveBeenCalled();
    expect(prisma.gameSession.findMany).not.toHaveBeenCalled();
  });
});
