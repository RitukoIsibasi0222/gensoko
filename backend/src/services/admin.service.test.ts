import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../lib/prisma.js";
import { createSerializableTransactionRunner } from "../lib/serializable-transaction-core.js";
import {
  AdminServiceError,
  ADMIN_USERS_DEFAULT_LIMIT,
  ADMIN_USERS_MAX_LIMIT,
  createAdminService,
} from "./admin.service.js";
import { createAuditService } from "./audit.service.js";

const {
  forceDeleteAdminUser,
  getAdminStats,
  getAdminUserDetail,
  getAdminUsers,
  updateAdminUserRole,
  updateAdminUserStatus,
} = createAdminService({
  prisma: prisma as never,
  runSerializableTransaction: createSerializableTransactionRunner(prisma as never),
  auditService: createAuditService(prisma as never),
});

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
      delete: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    refreshToken: { deleteMany: vi.fn() },
    passwordResetToken: { deleteMany: vi.fn() },
    emailVerification: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };

  vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(tx as never));

  return tx;
}

function expectSuccessAudit(
  createAuditLog: ReturnType<typeof vi.fn>,
  action: string,
  targetUserId = "user-1",
) {
  expect(createAuditLog).toHaveBeenCalledWith({
    data: {
      action,
      result: "SUCCESS",
      actorId: "admin-1",
      actorRole: "ADMIN",
      targetType: "USER",
      targetId: targetUserId,
      failureReason: null,
    },
  });
  expect(createAuditLog).toHaveBeenCalledTimes(1);
}

function expectFailureAudit(action: string, targetUserId: string | null, failureReason: string) {
  expect(prisma.auditLog.create).toHaveBeenCalledWith({
    data: {
      action,
      result: "FAILURE",
      actorId: "admin-1",
      actorRole: "ADMIN",
      targetType: targetUserId === null ? null : "USER",
      targetId: targetUserId,
      failureReason,
    },
  });
  expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
}

beforeEach(() => {
  vi.mocked(prisma.auditLog.create).mockReset();
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
});

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

  it("limit が非有限値や小数でも Prisma に渡す take は整数になる", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);

    await getAdminUsers({ limit: Number.NaN });
    await getAdminUsers({ limit: Number.POSITIVE_INFINITY });
    await getAdminUsers({ limit: 2.9 });
    await getAdminUsers({ limit: 101.9 });
    await getAdminUsers({ limit: 0.9 });

    expect(prisma.user.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: ADMIN_USERS_DEFAULT_LIMIT + 1 }),
    );
    expect(prisma.user.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ take: ADMIN_USERS_DEFAULT_LIMIT + 1 }),
    );
    expect(prisma.user.findMany).toHaveBeenNthCalledWith(3, expect.objectContaining({ take: 3 }));
    expect(prisma.user.findMany).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ take: ADMIN_USERS_MAX_LIMIT + 1 }),
    );
    expect(prisma.user.findMany).toHaveBeenNthCalledWith(5, expect.objectContaining({ take: 2 }));
  });

  it("cursor が存在しない場合は AdminServiceError(400) を投げる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    await expect(getAdminUsers({ limit: 20, cursor: "missing" })).rejects.toMatchObject({
      status: 400,
      message: "カーソルが正しくありません",
    });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("status 未指定なら現存する全Userを対象にする", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);

    await getAdminUsers();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      }),
    );
  });

  it("deprecated status=deleted は cursor を参照せず空一覧を返す", async () => {
    const result = await getAdminUsers({ status: "deleted", cursor: "legacy-cursor" });

    expect(result).toEqual({ users: [], nextCursor: null });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
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
    expectSuccessAudit(tx.auditLog.create, "ADMIN_USER_SUSPEND");
    expect(result.message).toBe("アカウントを停止しました");
  });

  it("停止解除時は専用actionで成功監査を記録する", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValue({ ...baseTargetUser, isActive: false });
    tx.user.update.mockResolvedValue({ ...baseTargetUser, isActive: true });

    const result = await updateAdminUserStatus({
      adminUserId: "admin-1",
      targetUserId: "user-1",
      isActive: true,
    });

    expectSuccessAudit(tx.auditLog.create, "ADMIN_USER_REACTIVATE");
    expect(result.message).toBe("アカウント停止を解除しました");
  });

  it("成功監査の保存失敗時は管理者操作全体を失敗させる", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValue(baseTargetUser);
    tx.user.update.mockResolvedValue({ ...baseTargetUser, isActive: false });
    tx.auditLog.create.mockRejectedValue(new Error("audit insert failed"));

    await expect(
      updateAdminUserStatus({
        adminUserId: "admin-1",
        targetUserId: "user-1",
        isActive: false,
      }),
    ).rejects.toThrow("audit insert failed");

    expect(tx.user.update).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("自分自身の停止/解除は AdminServiceError(409) にする", async () => {
    await expect(
      updateAdminUserStatus({ adminUserId: " admin-1 ", targetUserId: "admin-1", isActive: false }),
    ).rejects.toMatchObject({
      status: 409,
      message: "自分自身には実行できません",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expectFailureAudit("ADMIN_USER_SUSPEND", "admin-1", "SELF_OPERATION_DENIED");
  });

  it("失敗監査の保存失敗でも元のAdminServiceErrorを維持しraw errorを出力しない", async () => {
    const auditError = new Error("DATABASE_URL=postgres://secret@example.com/gensoko");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(prisma.auditLog.create).mockRejectedValue(auditError);

    await expect(
      updateAdminUserStatus({
        adminUserId: "admin-1",
        targetUserId: "admin-1",
        isActive: false,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "自分自身には実行できません",
    });

    const consoleErrorCalls = consoleErrorSpy.mock.calls;
    consoleErrorSpy.mockRestore();
    expect(consoleErrorCalls).toEqual([
      ["[audit] 監査ログの保存に失敗しました: action=ADMIN_USER_SUSPEND result=FAILURE"],
    ]);
    expect(consoleErrorCalls.flat()).not.toContain(auditError);
  });

  it.each([
    { name: "存在しないID", targetUserId: "missing" },
    { name: "メールアドレス", targetUserId: "secret@example.com" },
    { name: "token相当値", targetUserId: "a".repeat(64) },
  ])("対象が未確認の$nameは監査ログへ保存しない", async ({ targetUserId }) => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValue(null);

    await expect(
      updateAdminUserStatus({ adminUserId: "admin-1", targetUserId, isActive: false }),
    ).rejects.toMatchObject({
      status: 404,
      message: "ユーザーが見つかりません",
    });

    expectFailureAudit("ADMIN_USER_SUSPEND", null, "TARGET_NOT_FOUND");
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
    expectFailureAudit("ADMIN_USER_SUSPEND", "admin-2", "LAST_ADMIN_PROTECTED");
  });

  it("P2034後の再試行成功では成功監査を1件だけ記録する", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValue(baseTargetUser);
    tx.user.update.mockResolvedValue({ ...baseTargetUser, isActive: false });
    vi.mocked(prisma.$transaction)
      .mockReset()
      .mockRejectedValueOnce(createSerializationConflictError())
      .mockImplementationOnce(async (fn) => fn(tx as never));

    await updateAdminUserStatus({
      adminUserId: "admin-1",
      targetUserId: "user-1",
      isActive: false,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expectSuccessAudit(tx.auditLog.create, "ADMIN_USER_SUSPEND");
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
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
    expectFailureAudit("ADMIN_USER_SUSPEND", null, "SERIALIZATION_CONFLICT");
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
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
    expectSuccessAudit(tx.auditLog.create, "ADMIN_USER_ROLE_CHANGE");
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
    expectFailureAudit("ADMIN_USER_ROLE_CHANGE", "admin-1", "SELF_OPERATION_DENIED");
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
    expectFailureAudit("ADMIN_USER_ROLE_CHANGE", "user-1", "TARGET_STATE_CONFLICT");
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
    expectFailureAudit("ADMIN_USER_ROLE_CHANGE", "admin-2", "LAST_ADMIN_PROTECTED");
  });
});

describe("forceDeleteAdminUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("利用可能なactorを再確認し、targetを物理削除して同じtransactionへ成功監査を保存する", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValueOnce(baseAdminUser).mockResolvedValueOnce(baseTargetUser);
    tx.user.delete.mockResolvedValue({ id: "user-1" });

    const result = await forceDeleteAdminUser({ adminUserId: "admin-1", targetUserId: "user-1" });

    expect(tx.user.findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: "admin-1" },
      select: {
        id: true,
        role: true,
        isActive: true,
        emailVerified: true,
        lockedUntil: true,
      },
    });
    expect(tx.user.delete).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { id: true },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(tx.passwordResetToken.deleteMany).not.toHaveBeenCalled();
    expect(tx.emailVerification.deleteMany).not.toHaveBeenCalled();
    expectSuccessAudit(tx.auditLog.create, "ADMIN_USER_FORCE_DELETE");
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
    expectFailureAudit("ADMIN_USER_FORCE_DELETE", "admin-1", "SELF_OPERATION_DENIED");
  });

  it.each([
    ["不存在", null],
    ["USERへ降格", { ...baseAdminUser, role: "USER" }],
    ["停止", { ...baseAdminUser, isActive: false }],
    ["メール未確認", { ...baseAdminUser, emailVerified: false }],
    ["lock中", { ...baseAdminUser, lockedUntil: new Date("2099-01-01T00:00:00.000Z") }],
  ])("actorが%sなら409でtarget取得前に中止する", async (_label, actor) => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValueOnce(actor);

    await expect(
      forceDeleteAdminUser({ adminUserId: "admin-1", targetUserId: "user-1" }),
    ).rejects.toMatchObject({
      status: 409,
      message: "管理者の状態が変更されています。再ログインしてください",
    });
    expect(tx.user.findUnique).toHaveBeenCalledOnce();
    expect(tx.user.delete).not.toHaveBeenCalled();
    expectFailureAudit("ADMIN_USER_FORCE_DELETE", null, "ACTOR_STATE_CONFLICT");
  });

  it("targetが存在しない場合は404で失敗監査を記録する", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValueOnce(baseAdminUser).mockResolvedValueOnce(null);

    await expect(
      forceDeleteAdminUser({ adminUserId: "admin-1", targetUserId: "user-1" }),
    ).rejects.toMatchObject({
      status: 404,
      message: "ユーザーが見つかりません",
    });
    expect(tx.user.delete).not.toHaveBeenCalled();
    expectFailureAudit("ADMIN_USER_FORCE_DELETE", null, "TARGET_NOT_FOUND");
  });

  it("最後の利用可能なADMIN targetは409で保護する", async () => {
    const tx = mockTransaction();
    tx.user.findUnique
      .mockResolvedValueOnce(baseAdminUser)
      .mockResolvedValueOnce({ ...baseAdminUser, id: "admin-2" });
    tx.user.count.mockResolvedValue(1);

    await expect(
      forceDeleteAdminUser({ adminUserId: "admin-1", targetUserId: "admin-2" }),
    ).rejects.toMatchObject({
      status: 409,
      message: "最後の管理者は変更できません",
    });
    expect(tx.user.delete).not.toHaveBeenCalled();
    expectFailureAudit("ADMIN_USER_FORCE_DELETE", "admin-2", "LAST_ADMIN_PROTECTED");
  });

  it("P2034後の再試行成功では物理削除と成功監査を1件だけ実行する", async () => {
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValueOnce(baseAdminUser).mockResolvedValueOnce(baseTargetUser);
    tx.user.delete.mockResolvedValue({ id: "user-1" });
    vi.mocked(prisma.$transaction)
      .mockReset()
      .mockRejectedValueOnce(createSerializationConflictError())
      .mockImplementationOnce(async (fn) => fn(tx as never));

    await expect(
      forceDeleteAdminUser({ adminUserId: "admin-1", targetUserId: "user-1" }),
    ).resolves.toEqual({ message: "ユーザーを強制退会しました" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.user.delete).toHaveBeenCalledOnce();
    expectSuccessAudit(tx.auditLog.create, "ADMIN_USER_FORCE_DELETE");
  });

  it("P2034が2回続いた場合は409と分類済み失敗監査を返す", async () => {
    mockTransaction();
    vi.mocked(prisma.$transaction)
      .mockReset()
      .mockRejectedValue(createSerializationConflictError());

    await expect(
      forceDeleteAdminUser({ adminUserId: "admin-1", targetUserId: "user-1" }),
    ).rejects.toMatchObject({
      status: 409,
      message: "同時操作により処理できませんでした。再試行してください",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expectFailureAudit("ADMIN_USER_FORCE_DELETE", null, "SERIALIZATION_CONFLICT");
  });

  it("成功監査の保存に失敗した場合はerrorを伝播して成功扱いにしない", async () => {
    const auditError = new Error("audit insert failed");
    const tx = mockTransaction();
    tx.user.findUnique.mockResolvedValueOnce(baseAdminUser).mockResolvedValueOnce(baseTargetUser);
    tx.user.delete.mockResolvedValue({ id: "user-1" });
    tx.auditLog.create.mockRejectedValue(auditError);

    await expect(
      forceDeleteAdminUser({ adminUserId: "admin-1", targetUserId: "user-1" }),
    ).rejects.toBe(auditError);
    expect(tx.user.delete).toHaveBeenCalledOnce();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

describe("getAdminStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("legacy soft-deleted userを除外したcurrent data統計とdeleted互換値0を返す", async () => {
    vi.mocked(prisma.user.count)
      .mockResolvedValueOnce(95 as never)
      .mockResolvedValueOnce(90 as never)
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
        total: 95,
        active: 90,
        suspended: 5,
        deleted: 0,
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
    expect(prisma.user.count).toHaveBeenNthCalledWith(1);
    expect(prisma.user.count).toHaveBeenCalledTimes(5);
    expect(prisma.gameSession.count).toHaveBeenCalledWith();
    expect(prisma.weakElement.count).toHaveBeenCalledWith();
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
