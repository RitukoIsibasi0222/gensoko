import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    gameQuestionSet: {
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma.js";
import { cleanupExpiredGameQuestionSets } from "./cleanupGameQuestionSets.js";

const NOW = new Date("2026-06-21T09:00:00.000Z");
const FAILURE_MESSAGE = "期限切れ問題セットの削除に失敗しました";

describe("cleanupExpiredGameQuestionSets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes only expired question sets", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.mocked(prisma.gameQuestionSet.deleteMany).mockResolvedValue({ count: 3 } as never);

    const result = await cleanupExpiredGameQuestionSets({ now: NOW, logger });

    expect(prisma.gameQuestionSet.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: NOW } },
    });
    expect(result).toEqual({ deletedCount: 3, cutoff: NOW });
  });

  it("treats zero deleted rows as success", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.mocked(prisma.gameQuestionSet.deleteMany).mockResolvedValue({ count: 0 } as never);

    const result = await cleanupExpiredGameQuestionSets({ now: NOW, logger });

    expect(result.deletedCount).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs only the event, deleted count, and cutoff on success", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    vi.mocked(prisma.gameQuestionSet.deleteMany).mockResolvedValue({ count: 1 } as never);

    await cleanupExpiredGameQuestionSets({ now: NOW, logger });

    expect(logger.info).toHaveBeenCalledWith({
      event: "game_question_sets.cleanup.completed",
      deletedCount: 1,
      cutoff: NOW.toISOString(),
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("userId");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("questionSetId");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("questions");
  });

  it("logs a safe failure message and throws a sanitized error", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const error = new Error("database unavailable");
    vi.mocked(prisma.gameQuestionSet.deleteMany).mockRejectedValue(error as never);

    await expect(cleanupExpiredGameQuestionSets({ now: NOW, logger })).rejects.toThrow(
      FAILURE_MESSAGE,
    );

    expect(logger.error).toHaveBeenCalledWith({
      event: "game_question_sets.cleanup.failed",
      message: FAILURE_MESSAGE,
      cutoff: NOW.toISOString(),
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("database unavailable");
  });
});
