import { cleanupExpiredAuditLogs } from "./cleanupAuditLogs.js";
import { cleanupExpiredGameQuestionSets } from "./cleanupGameQuestionSets.js";
import { resetWeeklyScores } from "./resetWeeklyScores.js";

export const WEEKLY_SCORE_RESET_CRON = "0 15 * * SUN";
export const GITHUB_WEEKLY_SCORE_RESET_CRON = "7 15 * * 0";
export const LEGACY_GITHUB_WEEKLY_SCORE_RESET_CRON = "0 15 * * 0";
export const GITHUB_DAILY_GAME_QUESTION_SET_CLEANUP_CRON = "17 18 * * *";
export const AUDIT_LOG_CLEANUP_CRON = "37 18 * * *";

const BATCH_COMPLETED_EVENT = "batch.cron.completed";
const BATCH_FAILED_EVENT = "batch.cron.failed";
const BATCH_FAILED_MESSAGE = "定期バッチの実行に失敗しました";
const INVALID_SCHEDULED_TIME_MESSAGE = "定期バッチの実行時刻が不正です";
const UNKNOWN_CRON_MESSAGE = "未対応の定期バッチCronです";

export type ScheduledBatchJobName =
  | "resetWeeklyScores"
  | "cleanupExpiredGameQuestionSets"
  | "cleanupExpiredAuditLogs";

export type ScheduledBatchResult =
  | {
      job: "resetWeeklyScores";
      cron: string;
      executedAt: Date;
      resetCount: number;
    }
  | {
      job: "cleanupExpiredGameQuestionSets";
      cron: string;
      cutoff: Date;
      deletedCount: number;
    }
  | {
      job: "cleanupExpiredAuditLogs";
      cron: string;
      cutoff: Date;
      deletedCount: number;
      skipped: boolean;
      limitReached: boolean;
    };

export type ScheduledBatchLogger = Pick<Console, "info" | "warn" | "error">;

export type RunScheduledBatchOptions = {
  cron: string;
  scheduledTime: number;
  logger?: ScheduledBatchLogger;
};

function resolveScheduledBatchJobName(normalizedCron: string): ScheduledBatchJobName | null {
  if (
    normalizedCron === WEEKLY_SCORE_RESET_CRON ||
    normalizedCron === GITHUB_WEEKLY_SCORE_RESET_CRON ||
    normalizedCron === LEGACY_GITHUB_WEEKLY_SCORE_RESET_CRON
  ) {
    return "resetWeeklyScores";
  }

  if (normalizedCron === GITHUB_DAILY_GAME_QUESTION_SET_CLEANUP_CRON) {
    return "cleanupExpiredGameQuestionSets";
  }

  if (normalizedCron === AUDIT_LOG_CLEANUP_CRON) {
    return "cleanupExpiredAuditLogs";
  }

  return null;
}

function resolveScheduledDate(scheduledTime: number): Date {
  const scheduledDate = new Date(scheduledTime);

  if (Number.isFinite(scheduledTime) === false || Number.isNaN(scheduledDate.getTime())) {
    throw new Error(INVALID_SCHEDULED_TIME_MESSAGE);
  }

  return scheduledDate;
}

export async function runScheduledBatch({
  cron,
  scheduledTime,
  logger = console,
}: RunScheduledBatchOptions): Promise<ScheduledBatchResult> {
  const normalizedCron = cron.trim();
  let executedAt: Date;

  try {
    executedAt = resolveScheduledDate(scheduledTime);
  } catch {
    logger.error({
      event: BATCH_FAILED_EVENT,
      cron: normalizedCron,
      job: "unknown",
      message: INVALID_SCHEDULED_TIME_MESSAGE,
    });
    throw new Error(INVALID_SCHEDULED_TIME_MESSAGE);
  }

  const job = resolveScheduledBatchJobName(normalizedCron);

  if (job === null) {
    logger.error({
      event: BATCH_FAILED_EVENT,
      cron: normalizedCron,
      job: "unknown",
      message: UNKNOWN_CRON_MESSAGE,
      executedAt: executedAt.toISOString(),
    });
    throw new Error(UNKNOWN_CRON_MESSAGE);
  }

  try {
    if (job === "resetWeeklyScores") {
      const resetResult = await resetWeeklyScores({ now: executedAt, logger });
      const result = {
        job,
        cron: normalizedCron,
        executedAt: resetResult.executedAt,
        resetCount: resetResult.resetCount,
      } as const;

      logger.info({
        event: BATCH_COMPLETED_EVENT,
        cron: normalizedCron,
        job,
        executedAt: result.executedAt.toISOString(),
        resetCount: result.resetCount,
      });

      return result;
    }

    if (job === "cleanupExpiredGameQuestionSets") {
      const cleanupResult = await cleanupExpiredGameQuestionSets({ now: executedAt, logger });
      const result = {
        job,
        cron: normalizedCron,
        cutoff: cleanupResult.cutoff,
        deletedCount: cleanupResult.deletedCount,
      } as const;

      logger.info({
        event: BATCH_COMPLETED_EVENT,
        cron: normalizedCron,
        job,
        cutoff: result.cutoff.toISOString(),
        deletedCount: result.deletedCount,
      });

      return result;
    }

    const cleanupResult = await cleanupExpiredAuditLogs({
      now: executedAt,
      dryRun: false,
      logger,
    });

    if (cleanupResult.limitReached) {
      throw new Error(BATCH_FAILED_MESSAGE);
    }

    const result = {
      job,
      cron: normalizedCron,
      cutoff: cleanupResult.cutoff,
      deletedCount: cleanupResult.deletedCount,
      skipped: cleanupResult.skipped,
      limitReached: cleanupResult.limitReached,
    } as const;

    logger.info({
      event: BATCH_COMPLETED_EVENT,
      cron: normalizedCron,
      job,
      cutoff: result.cutoff.toISOString(),
      deletedCount: result.deletedCount,
      skipped: result.skipped,
      limitReached: result.limitReached,
    });

    return result;
  } catch {
    logger.error({
      event: BATCH_FAILED_EVENT,
      cron: normalizedCron,
      job,
      message: BATCH_FAILED_MESSAGE,
      executedAt: executedAt.toISOString(),
    });
    throw new Error(BATCH_FAILED_MESSAGE);
  }
}
