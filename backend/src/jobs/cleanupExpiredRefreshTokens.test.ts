import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    refreshToken: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma.js";
import {
  cleanupExpiredRefreshTokens,
  REFRESH_TOKEN_CLEANUP_BATCH_SIZE,
  REFRESH_TOKEN_CLEANUP_MAX_DURATION_MS,
  REFRESH_TOKEN_CLEANUP_MAX_ROWS_PER_RUN,
} from "./cleanupExpiredRefreshTokens.js";

const CUTOFF = new Date("2026-07-22T10:00:00.000Z");

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("期限切れrefresh token cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("固定batch・件数上限・時間上限を持つ", () => {
    expect(REFRESH_TOKEN_CLEANUP_BATCH_SIZE).toBe(500);
    expect(REFRESH_TOKEN_CLEANUP_MAX_ROWS_PER_RUN).toBe(10_000);
    expect(REFRESH_TOKEN_CLEANUP_MAX_DURATION_MS).toBe(480_000);
  });

  it("dry-runはcutoff未満だけを数え、tokenを選択・削除しない", async () => {
    const logger = createLogger();
    vi.mocked(prisma.refreshToken.count).mockResolvedValue(12);

    const result = await cleanupExpiredRefreshTokens({
      cutoff: CUTOFF,
      dryRun: true,
      executeEnabled: false,
      logger,
      getMonotonicTime: () => 1_000,
    });

    expect(prisma.refreshToken.count).toHaveBeenCalledWith({
      where: { expiresAt: { lt: CUTOFF } },
    });
    expect(prisma.refreshToken.findMany).not.toHaveBeenCalled();
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, deletedCount: 0, expiredCount: 12 });
  });

  it("execute無効時は安全側でskipする", async () => {
    const logger = createLogger();

    const result = await cleanupExpiredRefreshTokens({
      cutoff: CUTOFF,
      executeEnabled: false,
      logger,
      getMonotonicTime: () => 1_000,
    });

    expect(result).toMatchObject({ skipped: true, deletedCount: 0 });
    expect(prisma.refreshToken.findMany).not.toHaveBeenCalled();
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it("expiresAt/tokenHash順に選択し、選択hashとcutoffを再指定して1batch削除する", async () => {
    const logger = createLogger();
    vi.mocked(prisma.refreshToken.findMany).mockResolvedValueOnce([
      { tokenHash: "private-hash-a" },
      { tokenHash: "private-hash-b" },
    ] as never);
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValueOnce({ count: 2 } as never);

    const result = await cleanupExpiredRefreshTokens({
      cutoff: CUTOFF,
      executeEnabled: true,
      logger,
      getMonotonicTime: () => 1_000,
    });

    expect(prisma.refreshToken.findMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: CUTOFF } },
      orderBy: [{ expiresAt: "asc" }, { tokenHash: "asc" }],
      take: 500,
      select: { tokenHash: true },
    });
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: {
        tokenHash: { in: ["private-hash-a", "private-hash-b"] },
        expiresAt: { lt: CUTOFF },
      },
    });
    expect(result).toMatchObject({ skipped: false, deletedCount: 2, limitReached: false });
    const logs = JSON.stringify(logger.info.mock.calls);
    expect(logs).not.toContain("private-hash-a");
    expect(logs).not.toContain("private-hash-b");
  });

  it("cutoff同時刻と有効tokenを削除条件へ含めず、再実行可能にする", async () => {
    vi.mocked(prisma.refreshToken.findMany).mockResolvedValue([]);

    await cleanupExpiredRefreshTokens({
      cutoff: CUTOFF,
      executeEnabled: true,
      logger: createLogger(),
      getMonotonicTime: () => 1_000,
    });

    expect(prisma.refreshToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { expiresAt: { lt: CUTOFF } } }),
    );
  });

  it("別workerが選択済みbatchを先に削除しても次batchへ進む", async () => {
    const logger = createLogger();
    vi.mocked(prisma.refreshToken.findMany)
      .mockResolvedValueOnce([{ tokenHash: "contended-hash" }] as never)
      .mockResolvedValueOnce([{ tokenHash: "remaining-hash" }] as never);
    vi.mocked(prisma.refreshToken.deleteMany)
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);

    const result = await cleanupExpiredRefreshTokens({
      cutoff: CUTOFF,
      executeEnabled: true,
      logger,
      getMonotonicTime: () => 1_000,
    });

    expect(prisma.refreshToken.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.refreshToken.deleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        tokenHash: { in: ["remaining-hash"] },
        expiresAt: { lt: CUTOFF },
      },
    });
    expect(result.deletedCount).toBe(1);
  });

  it("DB error、token hash、DATABASE_URLをlogせず固定messageで失敗する", async () => {
    const logger = createLogger();
    vi.mocked(prisma.refreshToken.findMany).mockRejectedValue(
      new Error("DATABASE_URL=secret tokenHash=private-hash"),
    );

    await expect(
      cleanupExpiredRefreshTokens({
        cutoff: CUTOFF,
        executeEnabled: true,
        logger,
        getMonotonicTime: () => 1_000,
      }),
    ).rejects.toThrow("refresh token cleanupの実行に失敗しました");

    const logs = JSON.stringify(logger.error.mock.calls);
    expect(logs).not.toContain("DATABASE_URL");
    expect(logs).not.toContain("secret");
    expect(logs).not.toContain("private-hash");
  });
});
