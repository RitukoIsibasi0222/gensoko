import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    userStats: {
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma.js";
import { resetWeeklyScores } from "./resetWeeklyScores.js";

const NOW = new Date("2026-06-29T00:00:00.000Z");
const FAILURE_MESSAGE = "週間スコアのリセットに失敗しました";

describe("resetWeeklyScores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets only user stats whose weeklyScore is greater than zero", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.mocked(prisma.userStats.updateMany).mockResolvedValue({ count: 3 } as never);

    const result = await resetWeeklyScores({ now: NOW, logger });

    expect(prisma.userStats.updateMany).toHaveBeenCalledWith({
      where: { weeklyScore: { gt: 0 } },
      data: { weeklyScore: 0 },
    });
    expect(result).toEqual({ resetCount: 3, executedAt: NOW });
  });

  it("treats zero updated rows as success", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.mocked(prisma.userStats.updateMany).mockResolvedValue({ count: 0 } as never);

    const result = await resetWeeklyScores({ now: NOW, logger });

    expect(result.resetCount).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns zero on the second run when there are no weekly scores left to reset", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.mocked(prisma.userStats.updateMany)
      .mockResolvedValueOnce({ count: 2 } as never)
      .mockResolvedValueOnce({ count: 0 } as never);

    const firstResult = await resetWeeklyScores({ now: NOW, logger });
    const secondResult = await resetWeeklyScores({ now: NOW, logger });

    expect(firstResult).toEqual({ resetCount: 2, executedAt: NOW });
    expect(secondResult).toEqual({ resetCount: 0, executedAt: NOW });
    expect(prisma.userStats.updateMany).toHaveBeenCalledTimes(2);
  });

  it("logs only the event, reset count, and executedAt on success", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.mocked(prisma.userStats.updateMany).mockResolvedValue({ count: 1 } as never);

    await resetWeeklyScores({ now: NOW, logger });

    expect(logger.info).toHaveBeenCalledWith({
      event: "weekly_scores.reset.completed",
      resetCount: 1,
      executedAt: NOW.toISOString(),
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("userId");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("allTimeScore");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("totalGames");
  });

  it("logs a safe failure message and throws a sanitized error", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const error = new Error("database unavailable");
    vi.mocked(prisma.userStats.updateMany).mockRejectedValue(error as never);

    await expect(resetWeeklyScores({ now: NOW, logger })).rejects.toThrow(FAILURE_MESSAGE);

    expect(logger.error).toHaveBeenCalledWith({
      event: "weekly_scores.reset.failed",
      message: FAILURE_MESSAGE,
      executedAt: NOW.toISOString(),
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("database unavailable");
  });
});
