import { prisma } from "../lib/prisma.js";

const CLEANUP_COMPLETED_EVENT = "game_question_sets.cleanup.completed";
const CLEANUP_FAILED_EVENT = "game_question_sets.cleanup.failed";
const CLEANUP_FAILED_MESSAGE = "期限切れ問題セットの削除に失敗しました";

export type CleanupGameQuestionSetsResult = {
  deletedCount: number;
  cutoff: Date;
};

export type CleanupGameQuestionSetsLogger = Pick<Console, "info" | "error">;

export type CleanupGameQuestionSetsOptions = {
  now?: Date;
  logger?: CleanupGameQuestionSetsLogger;
};

export async function cleanupExpiredGameQuestionSets({
  now = new Date(),
  logger = console,
}: CleanupGameQuestionSetsOptions = {}): Promise<CleanupGameQuestionSetsResult> {
  const cutoff = now;

  try {
    const deleteResult = await prisma.gameQuestionSet.deleteMany({
      where: { expiresAt: { lte: cutoff } },
    });
    const result = { deletedCount: deleteResult.count, cutoff };

    logger.info({
      event: CLEANUP_COMPLETED_EVENT,
      deletedCount: result.deletedCount,
      cutoff: cutoff.toISOString(),
    });

    return result;
  } catch {
    logger.error({
      event: CLEANUP_FAILED_EVENT,
      message: CLEANUP_FAILED_MESSAGE,
      cutoff: cutoff.toISOString(),
    });
    throw new Error(CLEANUP_FAILED_MESSAGE);
  }
}
