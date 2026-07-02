import { prisma } from "../lib/prisma.js";
import { getWeeklyScoreWeekStart } from "../lib/weekly-score.js";

const RESET_COMPLETED_EVENT = "weekly_scores.reset.completed";
const RESET_FAILED_EVENT = "weekly_scores.reset.failed";
const RESET_FAILED_MESSAGE = "週間スコアのリセットに失敗しました";

export type ResetWeeklyScoresResult = {
  resetCount: number;
  executedAt: Date;
};

export type ResetWeeklyScoresLogger = Pick<Console, "info" | "error">;

export type ResetWeeklyScoresOptions = {
  now?: Date;
  logger?: ResetWeeklyScoresLogger;
};

export async function resetWeeklyScores({
  now = new Date(),
  logger = console,
}: ResetWeeklyScoresOptions = {}): Promise<ResetWeeklyScoresResult> {
  const executedAt = now;
  const weeklyScoreWeekStart = getWeeklyScoreWeekStart(executedAt);

  try {
    const updateResult = await prisma.userStats.updateMany({
      where: {
        OR: [
          { weeklyScoreWeekStart: null },
          { weeklyScoreWeekStart: { not: weeklyScoreWeekStart } },
          { weeklyScore: { lt: 0 } },
        ],
      },
      data: { weeklyScore: 0, weeklyScoreWeekStart },
    });
    const result = { resetCount: updateResult.count, executedAt };

    logger.info({
      event: RESET_COMPLETED_EVENT,
      resetCount: result.resetCount,
      executedAt: executedAt.toISOString(),
    });

    return result;
  } catch {
    logger.error({
      event: RESET_FAILED_EVENT,
      message: RESET_FAILED_MESSAGE,
      executedAt: executedAt.toISOString(),
    });
    throw new Error(RESET_FAILED_MESSAGE);
  }
}
