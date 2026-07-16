import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transactionClient = vi.hoisted(() => ({
  user: {
    deleteMany: vi.fn(),
  },
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    refreshToken: { count: vi.fn() },
    emailVerification: { count: vi.fn() },
    passwordResetToken: { count: vi.fn() },
    weakElement: { count: vi.fn() },
    gameSession: { count: vi.fn() },
    gameAnswer: { count: vi.fn() },
    gameQuestionSet: { count: vi.fn() },
    userStats: { count: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("../lib/serializable-transaction.js", () => ({
  runSerializableTransaction: vi.fn(
    async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
      await callback(transactionClient),
  ),
}));

import { prisma } from "../lib/prisma.js";
import { runSerializableTransaction } from "../lib/serializable-transaction.js";
import { deleteLegacySoftDeletedUsers } from "./deleteLegacySoftDeletedUsers.js";

const LEGACY_USER_WHERE = { deletedAt: { not: null } } as const;
const LEGACY_CHILD_WHERE = { user: LEGACY_USER_WHERE } as const;
const LEGACY_ANSWER_WHERE = { session: { user: LEGACY_USER_WHERE } } as const;
const TABLE_COUNTS = {
  users: 3,
  refreshTokens: 4,
  emailVerifications: 5,
  passwordResetTokens: 2,
  weakElements: 6,
  gameSessions: 7,
  gameAnswers: 8,
  gameQuestionSets: 3,
  userStats: 3,
} as const;

type TableCounts = Readonly<{
  [Key in keyof typeof TABLE_COUNTS]: number;
}>;

function mockTableCounts(counts: TableCounts = TABLE_COUNTS): void {
  vi.mocked(prisma.user.count).mockResolvedValueOnce(counts.users);
  vi.mocked(prisma.refreshToken.count).mockResolvedValueOnce(counts.refreshTokens);
  vi.mocked(prisma.emailVerification.count).mockResolvedValueOnce(counts.emailVerifications);
  vi.mocked(prisma.passwordResetToken.count).mockResolvedValueOnce(counts.passwordResetTokens);
  vi.mocked(prisma.weakElement.count).mockResolvedValueOnce(counts.weakElements);
  vi.mocked(prisma.gameSession.count).mockResolvedValueOnce(counts.gameSessions);
  vi.mocked(prisma.gameAnswer.count).mockResolvedValueOnce(counts.gameAnswers);
  vi.mocked(prisma.gameQuestionSet.count).mockResolvedValueOnce(counts.gameQuestionSets);
  vi.mocked(prisma.userStats.count).mockResolvedValueOnce(counts.userStats);
}

function expectFixedAggregationQueries(): void {
  expect(prisma.user.count).toHaveBeenNthCalledWith(1, {
    where: LEGACY_USER_WHERE,
  });
  expect(prisma.refreshToken.count).toHaveBeenCalledWith({
    where: LEGACY_CHILD_WHERE,
  });
  expect(prisma.emailVerification.count).toHaveBeenCalledWith({
    where: LEGACY_CHILD_WHERE,
  });
  expect(prisma.passwordResetToken.count).toHaveBeenCalledWith({
    where: LEGACY_CHILD_WHERE,
  });
  expect(prisma.weakElement.count).toHaveBeenCalledWith({
    where: LEGACY_CHILD_WHERE,
  });
  expect(prisma.gameSession.count).toHaveBeenCalledWith({
    where: LEGACY_CHILD_WHERE,
  });
  expect(prisma.gameAnswer.count).toHaveBeenCalledWith({
    where: LEGACY_ANSWER_WHERE,
  });
  expect(prisma.gameQuestionSet.count).toHaveBeenCalledWith({
    where: LEGACY_CHILD_WHERE,
  });
  expect(prisma.userStats.count).toHaveBeenCalledWith({
    where: LEGACY_CHILD_WHERE,
  });
}

describe("既存soft-deleted user cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(runSerializableTransaction).mockImplementation(
      async (callback) => await callback(transactionClient as never),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-runはUserと全所有tableを固定本数で集計し、削除しない", async () => {
    mockTableCounts();

    await expect(deleteLegacySoftDeletedUsers({ mode: "dry-run", batchSize: 2 })).resolves.toEqual({
      mode: "dry-run",
      matchedUsers: 3,
      deletedUsers: 0,
      processedBatches: 0,
      remainingUsers: 3,
    });

    expectFixedAggregationQueries();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(runSerializableTransaction).not.toHaveBeenCalled();
    expect(transactionClient.user.deleteMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "account_data_deletion.legacy_cleanup.previewed",
        mode: "dry-run",
        tableCounts: TABLE_COUNTS,
        batchSize: 2,
        requiredBatches: 2,
        matchedUsers: 3,
        deletedUsers: 0,
        processedBatches: 0,
        remainingUsers: 3,
        completion: "completed",
      }),
    );
  });

  it("dry-run対象0件は削除処理を開始せず正常終了する", async () => {
    const zeroCounts = {
      users: 0,
      refreshTokens: 0,
      emailVerifications: 0,
      passwordResetTokens: 0,
      weakElements: 0,
      gameSessions: 0,
      gameAnswers: 0,
      gameQuestionSets: 0,
      userStats: 0,
    } as const;
    mockTableCounts(zeroCounts);

    await expect(deleteLegacySoftDeletedUsers({ mode: "dry-run", batchSize: 25 })).resolves.toEqual(
      {
        mode: "dry-run",
        matchedUsers: 0,
        deletedUsers: 0,
        processedBatches: 0,
        remainingUsers: 0,
      },
    );
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(runSerializableTransaction).not.toHaveBeenCalled();
  });

  it("execute対象0件と再実行0件はtransactionなしで正常終了する", async () => {
    const zeroCounts = {
      users: 0,
      refreshTokens: 0,
      emailVerifications: 0,
      passwordResetTokens: 0,
      weakElements: 0,
      gameSessions: 0,
      gameAnswers: 0,
      gameQuestionSets: 0,
      userStats: 0,
    } as const;
    mockTableCounts(zeroCounts);
    vi.mocked(prisma.user.count).mockResolvedValueOnce(0);

    await expect(deleteLegacySoftDeletedUsers({ mode: "execute", batchSize: 25 })).resolves.toEqual(
      {
        mode: "execute",
        matchedUsers: 0,
        deletedUsers: 0,
        processedBatches: 0,
        remainingUsers: 0,
      },
    );
    expect(prisma.user.count).toHaveBeenCalledTimes(2);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(runSerializableTransaction).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "account_data_deletion.legacy_cleanup.completed",
        completion: "completed",
        remainingUsers: 0,
      }),
    );
  });

  it("executeは対象IDを順序固定で取得し、Serializable transaction内で条件付き削除する", async () => {
    mockTableCounts({
      ...TABLE_COUNTS,
      users: 2,
    });
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([
      { id: "legacy-user-1" },
      { id: "legacy-user-2" },
    ] as never);
    transactionClient.user.deleteMany.mockResolvedValueOnce({ count: 2 } as never);
    vi.mocked(prisma.user.count).mockResolvedValueOnce(0);

    await expect(deleteLegacySoftDeletedUsers({ mode: "execute", batchSize: 25 })).resolves.toEqual(
      {
        mode: "execute",
        matchedUsers: 2,
        deletedUsers: 2,
        processedBatches: 1,
        remainingUsers: 0,
      },
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: LEGACY_USER_WHERE,
      orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
      take: 25,
      select: { id: true },
    });
    expect(runSerializableTransaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.user.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["legacy-user-1", "legacy-user-2"] },
        deletedAt: { not: null },
      },
    });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    const logs = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(logs).not.toContain("legacy-user-1");
    expect(logs).not.toContain("legacy-user-2");
  });

  it("executeはbatchごとにcommitし、実削除件数とbatch数を集計する", async () => {
    mockTableCounts();
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce([{ id: "legacy-user-1" }, { id: "legacy-user-2" }] as never)
      .mockResolvedValueOnce([{ id: "legacy-user-3" }] as never);
    transactionClient.user.deleteMany
      .mockResolvedValueOnce({ count: 2 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.user.count).mockResolvedValueOnce(0);

    await expect(deleteLegacySoftDeletedUsers({ mode: "execute", batchSize: 2 })).resolves.toEqual({
      mode: "execute",
      matchedUsers: 3,
      deletedUsers: 3,
      processedBatches: 2,
      remainingUsers: 0,
    });
    expect(runSerializableTransaction).toHaveBeenCalledTimes(2);
    expect(transactionClient.user.deleteMany).toHaveBeenCalledTimes(2);
    expect(console.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "account_data_deletion.legacy_cleanup.completed",
        mode: "execute",
        matchedUsers: 3,
        deletedUsers: 3,
        processedBatches: 2,
        remainingUsers: 0,
        completion: "completed",
      }),
    );
  });

  it("並行削除で選択件数より実削除が少ない場合はdeleteManyのcountだけを計上する", async () => {
    mockTableCounts({
      ...TABLE_COUNTS,
      users: 2,
    });
    vi.mocked(prisma.user.findMany).mockResolvedValueOnce([
      { id: "legacy-user-1" },
      { id: "legacy-user-2" },
    ] as never);
    transactionClient.user.deleteMany.mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(prisma.user.count).mockResolvedValueOnce(0);

    await expect(
      deleteLegacySoftDeletedUsers({ mode: "execute", batchSize: 25 }),
    ).resolves.toMatchObject({
      matchedUsers: 2,
      deletedUsers: 1,
      processedBatches: 1,
      remainingUsers: 0,
    });
  });

  it("batch失敗時は後続batchを開始せず、安全な固定メッセージで失敗する", async () => {
    mockTableCounts();
    vi.mocked(prisma.user.findMany)
      .mockResolvedValueOnce([{ id: "legacy-user-1" }, { id: "legacy-user-2" }] as never)
      .mockResolvedValueOnce([{ id: "legacy-user-3" }] as never);
    transactionClient.user.deleteMany.mockResolvedValueOnce({ count: 2 } as never);
    const rawError = new Error(
      "postgres://secret-user:secret-password@production.internal/gensoko user-id=legacy-user-3",
    );
    vi.mocked(runSerializableTransaction)
      .mockImplementationOnce(async (callback) => await callback(transactionClient as never))
      .mockRejectedValueOnce(rawError);

    await expect(deleteLegacySoftDeletedUsers({ mode: "execute", batchSize: 2 })).rejects.toThrow(
      "既存退会済みユーザーの完全削除に失敗しました",
    );
    expect(runSerializableTransaction).toHaveBeenCalledTimes(2);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "account_data_deletion.legacy_cleanup.failed",
        mode: "execute",
        deletedUsers: 2,
        processedBatches: 1,
        completion: "failed",
      }),
    );
    const logs = JSON.stringify([
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ]);
    expect(logs).not.toContain("secret-user");
    expect(logs).not.toContain("secret-password");
    expect(logs).not.toContain("production.internal");
    expect(logs).not.toContain("legacy-user-3");
  });
});
