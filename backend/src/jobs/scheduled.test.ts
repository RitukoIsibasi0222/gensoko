import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./resetWeeklyScores.js", () => ({
  resetWeeklyScores: vi.fn(),
}));

vi.mock("./cleanupGameQuestionSets.js", () => ({
  cleanupExpiredGameQuestionSets: vi.fn(),
}));

import { cleanupExpiredGameQuestionSets } from "./cleanupGameQuestionSets.js";
import { resetWeeklyScores } from "./resetWeeklyScores.js";
import {
  GAME_QUESTION_SET_CLEANUP_CRON,
  GITHUB_WEEKLY_SCORE_RESET_CRON,
  WEEKLY_SCORE_RESET_CRON,
  runScheduledBatch,
} from "./scheduled.js";

const SCHEDULED_TIME = Date.parse("2026-07-05T15:00:00.000Z");
const SCHEDULED_DATE = new Date(SCHEDULED_TIME);
const FAILURE_MESSAGE = "定期バッチの実行に失敗しました";

describe("runScheduledBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs weekly score reset for the Cloudflare-style weekly cron", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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

  it("also accepts the GitHub Actions numeric Sunday cron for weekly reset", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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

  it("runs GameQuestionSet cleanup for the cleanup cron", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    vi.mocked(cleanupExpiredGameQuestionSets).mockResolvedValue({
      deletedCount: 2,
      cutoff: SCHEDULED_DATE,
    });

    const result = await runScheduledBatch({
      cron: GAME_QUESTION_SET_CLEANUP_CRON,
      scheduledTime: SCHEDULED_TIME,
      logger,
    });

    expect(cleanupExpiredGameQuestionSets).toHaveBeenCalledWith({ now: SCHEDULED_DATE, logger });
    expect(resetWeeklyScores).not.toHaveBeenCalled();
    expect(result).toEqual({
      job: "cleanupExpiredGameQuestionSets",
      cron: GAME_QUESTION_SET_CLEANUP_CRON,
      cutoff: SCHEDULED_DATE,
      deletedCount: 2,
    });
    expect(logger.info).toHaveBeenCalledWith({
      event: "batch.cron.completed",
      cron: GAME_QUESTION_SET_CLEANUP_CRON,
      job: "cleanupExpiredGameQuestionSets",
      cutoff: SCHEDULED_DATE.toISOString(),
      deletedCount: 2,
    });
  });

  it("skips unknown cron values without running database jobs", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const cron = "5 * * * *";

    const result = await runScheduledBatch({ cron, scheduledTime: SCHEDULED_TIME, logger });

    expect(resetWeeklyScores).not.toHaveBeenCalled();
    expect(cleanupExpiredGameQuestionSets).not.toHaveBeenCalled();
    expect(result).toEqual({ job: "unknown", cron, executedAt: SCHEDULED_DATE, skipped: true });
    expect(logger.warn).toHaveBeenCalledWith({
      event: "batch.cron.skipped",
      cron,
      message: "未対応の定期バッチCronです",
      executedAt: SCHEDULED_DATE.toISOString(),
    });
  });

  it("logs a sanitized failure when a scheduled job fails", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
