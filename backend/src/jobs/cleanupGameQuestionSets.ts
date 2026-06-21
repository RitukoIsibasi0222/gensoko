import { prisma } from "../lib/prisma.js";

const CLEANUP_COMPLETED_EVENT = "game_question_sets.cleanup.completed";
const CLEANUP_FAILED_EVENT = "game_question_sets.cleanup.failed";
const CLEANUP_FAILED_MESSAGE =
  "\u671f\u9650\u5207\u308c\u554f\u984c\u30bb\u30c3\u30c8\u306e\u524a\u9664\u306b\u5931\u6557\u3057\u307e\u3057\u305f";

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
  } catch (error) {
    logger.error({
      event: CLEANUP_FAILED_EVENT,
      message: CLEANUP_FAILED_MESSAGE,
      cutoff: cutoff.toISOString(),
    });
    throw error;
  }
}
