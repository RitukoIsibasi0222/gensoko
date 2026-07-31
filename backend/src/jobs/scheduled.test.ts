import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./resetWeeklyScores.js", () => ({
  resetWeeklyScores: vi.fn(),
}));

vi.mock("./cleanupGameQuestionSets.js", () => ({
  cleanupExpiredGameQuestionSets: vi.fn(),
}));

vi.mock("./cleanupAuditLogs.js", () => ({
  cleanupExpiredAuditLogs: vi.fn(),
}));

import { cleanupExpiredAuditLogs } from "./cleanupAuditLogs.js";
import { cleanupExpiredGameQuestionSets } from "./cleanupGameQuestionSets.js";
import { resetWeeklyScores } from "./resetWeeklyScores.js";
import {
  AUDIT_LOG_CLEANUP_CRON,
  GITHUB_DAILY_GAME_QUESTION_SET_CLEANUP_CRON,
  GITHUB_WEEKLY_SCORE_RESET_CRON,
  LEGACY_GITHUB_WEEKLY_SCORE_RESET_CRON,
  WEEKLY_SCORE_RESET_CRON,
  runScheduledBatch,
} from "./scheduled.js";

const SCHEDULED_TIME = Date.parse("2026-07-05T15:00:00.000Z");
const SCHEDULED_DATE = new Date(SCHEDULED_TIME);
const FAILURE_MESSAGE = "定期バッチの実行に失敗しました";
const INVALID_SCHEDULED_TIME_MESSAGE = "定期バッチの実行時刻が不正です";
const UNKNOWN_CRON_MESSAGE = "未対応の定期バッチCronです";

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("runScheduledBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs weekly score reset for the Cloudflare-style weekly cron", async () => {
    const logger = createLogger();
    vi.mocked(resetWeeklyScores).mockResolvedValue({ resetCount: 4, executedAt: SCHEDULED_DATE });

    const result = await runScheduledBatch({
      cron: WEEKLY_SCORE_RESET_CRON,
      scheduledTime: SCHEDULED_TIME,
      logger,
    });

    expect(resetWeeklyScores).toHaveBeenCalledWith({ now: SCHEDULED_DATE, logger });
    expect(cleanupExpiredGameQuestionSets).not.toHaveBeenCalled();
    expect(result).toEqual({
      job: "resetWeeklyScores",
      cron: WEEKLY_SCORE_RESET_CRON,
      executedAt: SCHEDULED_DATE,
      resetCount: 4,
    });
    expect(logger.info).toHaveBeenCalledWith({
      event: "batch.cron.completed",
      cron: WEEKLY_SCORE_RESET_CRON,
      job: "resetWeeklyScores",
      executedAt: SCHEDULED_DATE.toISOString(),
      resetCount: 4,
    });
  });

  it("accepts the delayed GitHub Actions Sunday cron for weekly reset", async () => {
    const logger = createLogger();
    vi.mocked(resetWeeklyScores).mockResolvedValue({ resetCount: 0, executedAt: SCHEDULED_DATE });

    const result = await runScheduledBatch({
      cron: GITHUB_WEEKLY_SCORE_RESET_CRON,
      scheduledTime: SCHEDULED_TIME,
      logger,
    });

    expect(resetWeeklyScores).toHaveBeenCalledWith({ now: SCHEDULED_DATE, logger });
    expect(result).toEqual({
      job: "resetWeeklyScores",
      cron: GITHUB_WEEKLY_SCORE_RESET_CRON,
      executedAt: SCHEDULED_DATE,
      resetCount: 0,
    });
  });

  it("also accepts the previous numeric Sunday cron for weekly reset", async () => {
    const logger = createLogger();
    vi.mocked(resetWeeklyScores).mockResolvedValue({ resetCount: 1, executedAt: SCHEDULED_DATE });

    const result = await runScheduledBatch({
      cron: LEGACY_GITHUB_WEEKLY_SCORE_RESET_CRON,
      scheduledTime: SCHEDULED_TIME,
      logger,
    });

    expect(resetWeeklyScores).toHaveBeenCalledWith({ now: SCHEDULED_DATE, logger });
    expect(result).toEqual({
      job: "resetWeeklyScores",
      cron: LEGACY_GITHUB_WEEKLY_SCORE_RESET_CRON,
      executedAt: SCHEDULED_DATE,
      resetCount: 1,
    });
  });

  it("runs GameQuestionSet cleanup for the daily GitHub Actions cron", async () => {
    const logger = createLogger();
    vi.mocked(cleanupExpiredGameQuestionSets).mockResolvedValue({
      deletedCount: 2,
      cutoff: SCHEDULED_DATE,
    });

    const result = await runScheduledBatch({
      cron: GITHUB_DAILY_GAME_QUESTION_SET_CLEANUP_CRON,
      scheduledTime: SCHEDULED_TIME,
      logger,
    });

    expect(cleanupExpiredGameQuestionSets).toHaveBeenCalledWith({ now: SCHEDULED_DATE, logger });
    expect(resetWeeklyScores).not.toHaveBeenCalled();
    expect(result).toEqual({
      job: "cleanupExpiredGameQuestionSets",
      cron: GITHUB_DAILY_GAME_QUESTION_SET_CLEANUP_CRON,
      cutoff: SCHEDULED_DATE,
      deletedCount: 2,
    });
    expect(logger.info).toHaveBeenCalledWith({
      event: "batch.cron.completed",
      cron: GITHUB_DAILY_GAME_QUESTION_SET_CLEANUP_CRON,
      job: "cleanupExpiredGameQuestionSets",
      cutoff: SCHEDULED_DATE.toISOString(),
      deletedCount: 2,
    });
  });

  it.each(["*/30 * * * *", "17,47 * * * *"])(
    "rejects the retired GameQuestionSet cleanup cron %s",
    async (cron) => {
      const logger = createLogger();

      await expect(
        runScheduledBatch({ cron, scheduledTime: SCHEDULED_TIME, logger }),
      ).rejects.toThrow(UNKNOWN_CRON_MESSAGE);

      expect(resetWeeklyScores).not.toHaveBeenCalled();
      expect(cleanupExpiredGameQuestionSets).not.toHaveBeenCalled();
      expect(cleanupExpiredAuditLogs).not.toHaveBeenCalled();
    },
  );

  it("runs audit log cleanup for the daily audit cron", async () => {
    const logger = createLogger();
    vi.mocked(cleanupExpiredAuditLogs).mockResolvedValue({
      cutoff: SCHEDULED_DATE,
      retentionDays: 365,
      dryRun: false,
      skipped: false,
      deletedCount: 3,
      durationMs: 25,
      limitReached: false,
      healthBefore: {
        createdLast24HoursCount: 8,
        hasExpiredRows: true,
        oldestOccurredAt: SCHEDULED_DATE,
        latestOccurredAt: SCHEDULED_DATE,
      },
    });

    const result = await runScheduledBatch({
      cron: AUDIT_LOG_CLEANUP_CRON,
      scheduledTime: SCHEDULED_TIME,
      logger,
    });

    expect(cleanupExpiredAuditLogs).toHaveBeenCalledWith({
      now: SCHEDULED_DATE,
      dryRun: false,
      logger,
    });
    expect(resetWeeklyScores).not.toHaveBeenCalled();
    expect(cleanupExpiredGameQuestionSets).not.toHaveBeenCalled();
    expect(result).toEqual({
      job: "cleanupExpiredAuditLogs",
      cron: AUDIT_LOG_CLEANUP_CRON,
      cutoff: SCHEDULED_DATE,
      deletedCount: 3,
      skipped: false,
      limitReached: false,
    });
    expect(logger.info).toHaveBeenCalledWith({
      event: "batch.cron.completed",
      cron: AUDIT_LOG_CLEANUP_CRON,
      job: "cleanupExpiredAuditLogs",
      cutoff: SCHEDULED_DATE.toISOString(),
      deletedCount: 3,
      skipped: false,
      limitReached: false,
    });
  });

  it("treats disabled audit log cleanup as a successful scheduled skip", async () => {
    const logger = createLogger();
    vi.mocked(cleanupExpiredAuditLogs).mockResolvedValue({
      cutoff: SCHEDULED_DATE,
      retentionDays: 365,
      dryRun: false,
      skipped: true,
      deletedCount: 0,
      durationMs: 10,
      limitReached: false,
      healthBefore: {
        createdLast24HoursCount: 8,
        hasExpiredRows: true,
        oldestOccurredAt: SCHEDULED_DATE,
        latestOccurredAt: SCHEDULED_DATE,
      },
    });

    const result = await runScheduledBatch({
      cron: AUDIT_LOG_CLEANUP_CRON,
      scheduledTime: SCHEDULED_TIME,
      logger,
    });

    expect(result).toMatchObject({
      job: "cleanupExpiredAuditLogs",
      skipped: true,
      deletedCount: 0,
      limitReached: false,
    });
  });

  it("fails the scheduled batch when audit cleanup reaches a safety limit with rows remaining", async () => {
    const logger = createLogger();
    vi.mocked(cleanupExpiredAuditLogs).mockResolvedValue({
      cutoff: SCHEDULED_DATE,
      retentionDays: 365,
      dryRun: false,
      skipped: false,
      deletedCount: 10_000,
      durationMs: 480_000,
      limitReached: true,
      healthBefore: {
        createdLast24HoursCount: 8,
        hasExpiredRows: true,
        oldestOccurredAt: SCHEDULED_DATE,
        latestOccurredAt: SCHEDULED_DATE,
      },
    });

    await expect(
      runScheduledBatch({
        cron: AUDIT_LOG_CLEANUP_CRON,
        scheduledTime: SCHEDULED_TIME,
        logger,
      }),
    ).rejects.toThrow(FAILURE_MESSAGE);

    expect(logger.error).toHaveBeenCalledWith({
      event: "batch.cron.failed",
      cron: AUDIT_LOG_CLEANUP_CRON,
      job: "cleanupExpiredAuditLogs",
      message: FAILURE_MESSAGE,
      executedAt: SCHEDULED_DATE.toISOString(),
    });
  });

  it("rejects unknown cron values without running database jobs", async () => {
    const logger = createLogger();
    const cron = "5 * * * *";

    await expect(
      runScheduledBatch({ cron, scheduledTime: SCHEDULED_TIME, logger }),
    ).rejects.toThrow(UNKNOWN_CRON_MESSAGE);

    expect(resetWeeklyScores).not.toHaveBeenCalled();
    expect(cleanupExpiredGameQuestionSets).not.toHaveBeenCalled();
    expect(cleanupExpiredAuditLogs).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith({
      event: "batch.cron.failed",
      cron,
      job: "unknown",
      message: UNKNOWN_CRON_MESSAGE,
      executedAt: SCHEDULED_DATE.toISOString(),
    });
  });

  it("rejects invalid scheduledTime without leaking a RangeError", async () => {
    const logger = createLogger();

    await expect(
      runScheduledBatch({ cron: WEEKLY_SCORE_RESET_CRON, scheduledTime: Number.NaN, logger }),
    ).rejects.toThrow(INVALID_SCHEDULED_TIME_MESSAGE);

    expect(resetWeeklyScores).not.toHaveBeenCalled();
    expect(cleanupExpiredGameQuestionSets).not.toHaveBeenCalled();
    expect(cleanupExpiredAuditLogs).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith({
      event: "batch.cron.failed",
      cron: WEEKLY_SCORE_RESET_CRON,
      job: "unknown",
      message: INVALID_SCHEDULED_TIME_MESSAGE,
    });
  });

  it("logs a sanitized failure when a scheduled job fails", async () => {
    const logger = createLogger();
    vi.mocked(resetWeeklyScores).mockRejectedValue(new Error("database unavailable: user_stats"));

    await expect(
      runScheduledBatch({ cron: WEEKLY_SCORE_RESET_CRON, scheduledTime: SCHEDULED_TIME, logger }),
    ).rejects.toThrow(FAILURE_MESSAGE);

    expect(logger.error).toHaveBeenCalledWith({
      event: "batch.cron.failed",
      cron: WEEKLY_SCORE_RESET_CRON,
      job: "resetWeeklyScores",
      message: FAILURE_MESSAGE,
      executedAt: SCHEDULED_DATE.toISOString(),
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("database unavailable");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("user_stats");
  });
});
