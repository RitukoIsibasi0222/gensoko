import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    auditLog: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma.js";
import {
  AUDIT_LOG_CLEANUP_BATCH_SIZE,
  AUDIT_LOG_CLEANUP_MAX_DURATION_MS,
  AUDIT_LOG_CLEANUP_MAX_ROWS_PER_RUN,
  calculateAuditLogCutoff,
  cleanupExpiredAuditLogs,
  inspectAuditLogHealth,
  previewExpiredAuditLogs,
} from "./cleanupAuditLogs.js";

const NOW = new Date("2026-07-13T09:00:00.000Z");
const CUTOFF = new Date("2025-07-13T09:00:00.000Z");
const LAST_24_HOURS_START = new Date("2026-07-12T09:00:00.000Z");
const OLDEST_OCCURRED_AT = new Date("2024-01-01T00:00:00.000Z");
const LATEST_OCCURRED_AT = new Date("2026-07-13T08:30:00.000Z");
const ENABLED_CONFIG = { retentionDays: 365, cleanupEnabled: true } as const;
const DISABLED_CONFIG = { retentionDays: 365, cleanupEnabled: false } as const;

function mockHealthSnapshot({ hasExpiredRows = true }: { hasExpiredRows?: boolean } = {}): void {
  vi.mocked(prisma.auditLog.count).mockResolvedValueOnce(12);
  vi.mocked(prisma.auditLog.findFirst)
    .mockResolvedValueOnce({ occurredAt: OLDEST_OCCURRED_AT } as never)
    .mockResolvedValueOnce({ occurredAt: LATEST_OCCURRED_AT } as never)
    .mockResolvedValueOnce(hasExpiredRows ? ({ id: "expired-audit-log" } as never) : null);
}

describe("監査ログcleanupの保持期限と安全上限", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("保持日数を固定24時間の経過時間としてUTC時刻から差し引く", () => {
    const originalNow = new Date(NOW);

    expect(calculateAuditLogCutoff(NOW, 365)).toEqual(CUTOFF);
    expect(NOW).toEqual(originalNow);
  });

  it("分割削除と1回の実行に固定安全上限を設ける", () => {
    expect(AUDIT_LOG_CLEANUP_BATCH_SIZE).toBe(500);
    expect(AUDIT_LOG_CLEANUP_MAX_ROWS_PER_RUN).toBe(10_000);
    expect(AUDIT_LOG_CLEANUP_MAX_DURATION_MS).toBe(480_000);
  });

  it("定期状態確認では直近24時間だけを数え、最古・最新・期限超過有無を取得する", async () => {
    mockHealthSnapshot();

    const result = await inspectAuditLogHealth({ now: NOW, config: ENABLED_CONFIG });

    expect(prisma.auditLog.count).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: { occurredAt: { gte: LAST_24_HOURS_START } },
    });
    expect(prisma.auditLog.findFirst).toHaveBeenNthCalledWith(1, {
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { occurredAt: true },
    });
    expect(prisma.auditLog.findFirst).toHaveBeenNthCalledWith(2, {
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { occurredAt: true },
    });
    expect(prisma.auditLog.findFirst).toHaveBeenNthCalledWith(3, {
      where: { occurredAt: { lt: CUTOFF } },
      select: { id: true },
    });
    expect(result).toEqual({
      createdLast24HoursCount: 12,
      hasExpiredRows: true,
      oldestOccurredAt: OLDEST_OCCURRED_AT,
      latestOccurredAt: LATEST_OCCURRED_AT,
    });
  });

  it("監査ログが0件の場合は日時をnull、期限超過なしとして返す", async () => {
    vi.mocked(prisma.auditLog.count).mockResolvedValueOnce(0);
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null);

    await expect(inspectAuditLogHealth({ now: NOW, config: ENABLED_CONFIG })).resolves.toEqual({
      createdLast24HoursCount: 0,
      hasExpiredRows: false,
      oldestOccurredAt: null,
      latestOccurredAt: null,
    });
  });

  it("手動previewだけが期限超過総件数と最低実行回数を計算する", async () => {
    vi.mocked(prisma.auditLog.count).mockResolvedValueOnce(10_001);

    const result = await previewExpiredAuditLogs({ now: NOW, config: ENABLED_CONFIG });

    expect(prisma.auditLog.count).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: { occurredAt: { lt: CUTOFF } },
    });
    expect(result).toEqual({
      cutoff: CUTOFF,
      expiredCount: 10_001,
      minimumRunsRequired: 2,
    });
  });

  it("dry-runはpreview結果を安全ログへ出し、監査ログを削除しない", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    mockHealthSnapshot();
    vi.mocked(prisma.auditLog.count).mockResolvedValueOnce(10_001);

    const result = await cleanupExpiredAuditLogs({
      now: NOW,
      dryRun: true,
      config: ENABLED_CONFIG,
      logger,
      getMonotonicTime: () => 1_000,
    });

    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      cutoff: CUTOFF,
      retentionDays: 365,
      dryRun: true,
      skipped: false,
      deletedCount: 0,
      durationMs: 0,
      limitReached: false,
      healthBefore: {
        createdLast24HoursCount: 12,
        hasExpiredRows: true,
        oldestOccurredAt: OLDEST_OCCURRED_AT,
        latestOccurredAt: LATEST_OCCURRED_AT,
      },
    });
    expect(logger.info).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.previewed",
      cutoff: CUTOFF.toISOString(),
      retentionDays: 365,
      dryRun: true,
      deletedCount: 0,
      createdLast24HoursCount: 12,
      hasExpiredRows: true,
      oldestOccurredAt: OLDEST_OCCURRED_AT.toISOString(),
      latestOccurredAt: LATEST_OCCURRED_AT.toISOString(),
      durationMs: 0,
      limitReached: false,
      expiredCount: 10_001,
      minimumRunsRequired: 2,
    });
  });

  it("cleanup無効時は低負荷な状態確認だけを行い、削除をskipする", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    mockHealthSnapshot();

    const result = await cleanupExpiredAuditLogs({
      now: NOW,
      dryRun: false,
      config: DISABLED_CONFIG,
      logger,
      getMonotonicTime: () => 1_000,
    });

    expect(prisma.auditLog.count).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      cutoff: CUTOFF,
      retentionDays: 365,
      dryRun: false,
      skipped: true,
      deletedCount: 0,
      durationMs: 0,
      limitReached: false,
      healthBefore: {
        createdLast24HoursCount: 12,
        hasExpiredRows: true,
        oldestOccurredAt: OLDEST_OCCURRED_AT,
        latestOccurredAt: LATEST_OCCURRED_AT,
      },
    });
    expect(logger.warn).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.skipped",
      cutoff: CUTOFF.toISOString(),
      retentionDays: 365,
      dryRun: false,
      deletedCount: 0,
      createdLast24HoursCount: 12,
      hasExpiredRows: true,
      oldestOccurredAt: OLDEST_OCCURRED_AT.toISOString(),
      latestOccurredAt: LATEST_OCCURRED_AT.toISOString(),
      durationMs: 0,
      limitReached: false,
      message: "監査ログcleanupは無効です",
    });
  });
});

describe("監査ログの分割cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("期限超過ログが0件の場合は削除せず成功する", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    mockHealthSnapshot({ hasExpiredRows: false });
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([]);

    const result = await cleanupExpiredAuditLogs({
      now: NOW,
      config: ENABLED_CONFIG,
      logger,
      getMonotonicTime: () => 1_000,
    });

    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      deletedCount: 0,
      skipped: false,
      limitReached: false,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "audit_logs.cleanup.completed",
        deletedCount: 0,
        limitReached: false,
      }),
    );
  });

  it("500件未満はIDとcutoffを再指定して1batchで削除する", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const rows = [{ id: "audit-log-1" }, { id: "audit-log-2" }];
    mockHealthSnapshot();
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce(rows as never);
    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValueOnce({ count: 2 } as never);

    const result = await cleanupExpiredAuditLogs({
      now: NOW,
      config: ENABLED_CONFIG,
      logger,
      getMonotonicTime: () => 1_000,
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { occurredAt: { lt: CUTOFF } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: 500,
      select: { id: true },
    });
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["audit-log-1", "audit-log-2"] },
        occurredAt: { lt: CUTOFF },
      },
    });
    expect(result).toMatchObject({
      deletedCount: 2,
      skipped: false,
      limitReached: false,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("audit-log-1");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("audit-log-2");
  });

  it("500件ちょうどの場合は次の取得で残件0を確認して終了する", async () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({ id: `batch-1-${index}` }));
    mockHealthSnapshot();
    vi.mocked(prisma.auditLog.findMany)
      .mockResolvedValueOnce(rows as never)
      .mockResolvedValueOnce([]);
    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValueOnce({ count: 500 } as never);

    const result = await cleanupExpiredAuditLogs({
      now: NOW,
      config: ENABLED_CONFIG,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getMonotonicTime: () => 1_000,
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledTimes(1);
    expect(result.deletedCount).toBe(500);
    expect(result.limitReached).toBe(false);
  });

  it("501件を500件と1件の2batchに分けて削除する", async () => {
    const firstBatch = Array.from({ length: 500 }, (_, index) => ({ id: `batch-1-${index}` }));
    const secondBatch = [{ id: "batch-2-0" }];
    mockHealthSnapshot();
    vi.mocked(prisma.auditLog.findMany)
      .mockResolvedValueOnce(firstBatch as never)
      .mockResolvedValueOnce(secondBatch as never);
    vi.mocked(prisma.auditLog.deleteMany)
      .mockResolvedValueOnce({ count: 500 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);

    const result = await cleanupExpiredAuditLogs({
      now: NOW,
      config: ENABLED_CONFIG,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getMonotonicTime: () => 1_000,
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledTimes(2);
    expect(result.deletedCount).toBe(501);
    expect(result.limitReached).toBe(false);
  });

  it("対象取得後に別実行が一部を削除してもdeleteManyの実件数を集計する", async () => {
    mockHealthSnapshot();
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      { id: "concurrent-1" },
      { id: "concurrent-2" },
    ] as never);
    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValueOnce({ count: 1 } as never);

    const result = await cleanupExpiredAuditLogs({
      now: NOW,
      config: ENABLED_CONFIG,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getMonotonicTime: () => 1_000,
    });

    expect(result.deletedCount).toBe(1);
    expect(result.limitReached).toBe(false);
  });

  it("10,000件削除後に残件がある場合は件数上限到達として返す", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let batchNumber = 0;
    mockHealthSnapshot();
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValueOnce({ id: "remaining-log" } as never);
    vi.mocked(prisma.auditLog.findMany).mockImplementation((async () => {
      batchNumber += 1;
      return Array.from({ length: 500 }, (_, index) => ({
        id: `limit-${batchNumber}-${index}`,
      }));
    }) as never);
    vi.mocked(prisma.auditLog.deleteMany).mockResolvedValue({ count: 500 } as never);

    const result = await cleanupExpiredAuditLogs({
      now: NOW,
      config: ENABLED_CONFIG,
      logger,
      getMonotonicTime: () => 1_000,
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(20);
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledTimes(20);
    expect(result.deletedCount).toBe(10_000);
    expect(result.limitReached).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "audit_logs.cleanup.limit_reached",
        deletedCount: 10_000,
        limitReached: true,
      }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("remaining-log");
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("limit-1-0");
  });

  it("8分到達時は次batchを開始せず、残件を上限到達として返す", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const getMonotonicTime = vi.fn().mockReturnValueOnce(0).mockReturnValue(480_000);
    mockHealthSnapshot();
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValueOnce({
      id: "remaining-after-time-limit",
    } as never);

    const result = await cleanupExpiredAuditLogs({
      now: NOW,
      config: ENABLED_CONFIG,
      logger,
      getMonotonicTime,
    });

    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(result.deletedCount).toBe(0);
    expect(result.durationMs).toBe(480_000);
    expect(result.limitReached).toBe(true);
  });

  it("DBエラー時はraw errorと監査ログIDを出さず固定メッセージで失敗する", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const databaseError = new Error("DATABASE_URL=secret audit-log-id=private-id");
    mockHealthSnapshot();
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([{ id: "private-id" }] as never);
    vi.mocked(prisma.auditLog.deleteMany).mockRejectedValueOnce(databaseError);

    await expect(
      cleanupExpiredAuditLogs({
        now: NOW,
        config: ENABLED_CONFIG,
        logger,
        getMonotonicTime: () => 1_000,
      }),
    ).rejects.toThrow("監査ログcleanupの実行に失敗しました");

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "audit_logs.cleanup.failed",
        message: "監査ログcleanupの実行に失敗しました",
      }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private-id");
  });

  it("状態監視のDBエラー時は削除を開始せずPIIとraw errorを出さない", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const databaseError = new Error(
      "DATABASE_URL=secret actorId=private-actor targetId=private-target email=private@example.com",
    );
    vi.mocked(prisma.auditLog.count).mockRejectedValueOnce(databaseError);

    await expect(
      cleanupExpiredAuditLogs({
        now: NOW,
        config: ENABLED_CONFIG,
        logger,
        getMonotonicTime: () => 1_000,
      }),
    ).rejects.toThrow("監査ログcleanupの実行に失敗しました");

    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith({
      event: "audit_logs.cleanup.failed",
      cutoff: CUTOFF.toISOString(),
      retentionDays: 365,
      dryRun: false,
      deletedCount: 0,
      durationMs: 0,
      limitReached: false,
      message: "監査ログcleanupの実行に失敗しました",
    });

    const output = JSON.stringify(logger.error.mock.calls);
    expect(output).not.toContain("DATABASE_URL");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("private-actor");
    expect(output).not.toContain("private-target");
    expect(output).not.toContain("private@example.com");
  });
});
