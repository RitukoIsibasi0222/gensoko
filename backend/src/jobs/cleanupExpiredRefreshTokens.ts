import { getRefreshTokenCleanupConfig } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";

const CLEANUP_PREVIEWED_EVENT = "refresh_tokens.cleanup.previewed";
const CLEANUP_COMPLETED_EVENT = "refresh_tokens.cleanup.completed";
const CLEANUP_SKIPPED_EVENT = "refresh_tokens.cleanup.skipped";
const CLEANUP_LIMIT_REACHED_EVENT = "refresh_tokens.cleanup.limit_reached";
const CLEANUP_FAILED_EVENT = "refresh_tokens.cleanup.failed";
const CLEANUP_DISABLED_MESSAGE = "refresh token cleanupは無効です";
const CLEANUP_FAILED_MESSAGE = "refresh token cleanupの実行に失敗しました";

export const REFRESH_TOKEN_CLEANUP_BATCH_SIZE = 500;
export const REFRESH_TOKEN_CLEANUP_MAX_ROWS_PER_RUN = 10_000;
export const REFRESH_TOKEN_CLEANUP_MAX_DURATION_MS = 480_000;

export type CleanupExpiredRefreshTokensResult = Readonly<{
  cutoff: Date;
  dryRun: boolean;
  skipped: boolean;
  expiredCount: number | null;
  deletedCount: number;
  durationMs: number;
  limitReached: boolean;
}>;

export type CleanupExpiredRefreshTokensOptions = Readonly<{
  cutoff?: Date;
  dryRun?: boolean;
  executeEnabled?: boolean;
  logger?: Pick<Console, "info" | "warn" | "error">;
  getMonotonicTime?: () => number;
}>;

async function hasExpiredRefreshTokens(cutoff: Date): Promise<boolean> {
  return (
    (await prisma.refreshToken.findFirst({
      where: { expiresAt: { lt: cutoff } },
      select: { tokenHash: true },
    })) !== null
  );
}

export async function cleanupExpiredRefreshTokens({
  cutoff = new Date(),
  dryRun = false,
  executeEnabled = getRefreshTokenCleanupConfig().executeEnabled,
  logger = console,
  getMonotonicTime = () => performance.now(),
}: CleanupExpiredRefreshTokensOptions = {}): Promise<CleanupExpiredRefreshTokensResult> {
  const startedAt = getMonotonicTime();
  let deletedCount = 0;
  const getDurationMs = () => Math.max(0, getMonotonicTime() - startedAt);

  try {
    if (Number.isNaN(cutoff.getTime())) {
      throw new Error(CLEANUP_FAILED_MESSAGE);
    }

    if (dryRun) {
      const expiredCount = await prisma.refreshToken.count({
        where: { expiresAt: { lt: cutoff } },
      });
      const result = {
        cutoff,
        dryRun,
        skipped: false,
        expiredCount,
        deletedCount,
        durationMs: getDurationMs(),
        limitReached: false,
      } as const;
      logger.info({
        event: CLEANUP_PREVIEWED_EVENT,
        cutoff: cutoff.toISOString(),
        expiredCount,
        deletedCount,
        durationMs: result.durationMs,
        limitReached: false,
      });
      return result;
    }

    if (!executeEnabled) {
      const result = {
        cutoff,
        dryRun,
        skipped: true,
        expiredCount: null,
        deletedCount,
        durationMs: getDurationMs(),
        limitReached: false,
      } as const;
      logger.warn({
        event: CLEANUP_SKIPPED_EVENT,
        cutoff: cutoff.toISOString(),
        deletedCount,
        durationMs: result.durationMs,
        limitReached: false,
        message: CLEANUP_DISABLED_MESSAGE,
      });
      return result;
    }

    let safetyLimitReached = false;
    while (deletedCount < REFRESH_TOKEN_CLEANUP_MAX_ROWS_PER_RUN) {
      if (getDurationMs() >= REFRESH_TOKEN_CLEANUP_MAX_DURATION_MS) {
        safetyLimitReached = true;
        break;
      }

      const batchSize = Math.min(
        REFRESH_TOKEN_CLEANUP_BATCH_SIZE,
        REFRESH_TOKEN_CLEANUP_MAX_ROWS_PER_RUN - deletedCount,
      );
      const rows = await prisma.refreshToken.findMany({
        where: { expiresAt: { lt: cutoff } },
        orderBy: [{ expiresAt: "asc" }, { tokenHash: "asc" }],
        take: batchSize,
        select: { tokenHash: true },
      });
      if (rows.length === 0) break;

      const deleteResult = await prisma.refreshToken.deleteMany({
        where: {
          tokenHash: { in: rows.map((row) => row.tokenHash) },
          expiresAt: { lt: cutoff },
        },
      });
      deletedCount += deleteResult.count;

      if (deleteResult.count === 0 || rows.length < batchSize) break;
    }

    if (deletedCount >= REFRESH_TOKEN_CLEANUP_MAX_ROWS_PER_RUN) {
      safetyLimitReached = true;
    }
    const limitReached = safetyLimitReached && (await hasExpiredRefreshTokens(cutoff));
    const result = {
      cutoff,
      dryRun,
      skipped: false,
      expiredCount: null,
      deletedCount,
      durationMs: getDurationMs(),
      limitReached,
    } as const;
    const log = limitReached ? logger.warn : logger.info;
    log({
      event: limitReached ? CLEANUP_LIMIT_REACHED_EVENT : CLEANUP_COMPLETED_EVENT,
      cutoff: cutoff.toISOString(),
      deletedCount,
      durationMs: result.durationMs,
      limitReached,
    });
    return result;
  } catch {
    logger.error({
      event: CLEANUP_FAILED_EVENT,
      ...(Number.isNaN(cutoff.getTime()) ? {} : { cutoff: cutoff.toISOString() }),
      deletedCount,
      durationMs: getDurationMs(),
      limitReached: false,
      message: CLEANUP_FAILED_MESSAGE,
    });
    throw new Error(CLEANUP_FAILED_MESSAGE);
  }
}
