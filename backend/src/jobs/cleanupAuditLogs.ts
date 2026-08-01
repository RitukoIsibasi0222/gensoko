import { getAuditLogRetentionConfig, type AuditLogRetentionConfig } from "../lib/config.js";
import { prisma } from "../lib/prisma.js";
import { MILLISECONDS_PER_DAY } from "../lib/time.js";

const CLEANUP_PREVIEWED_EVENT = "audit_logs.cleanup.previewed";
const CLEANUP_COMPLETED_EVENT = "audit_logs.cleanup.completed";
const CLEANUP_SKIPPED_EVENT = "audit_logs.cleanup.skipped";
const CLEANUP_LIMIT_REACHED_EVENT = "audit_logs.cleanup.limit_reached";
const CLEANUP_FAILED_EVENT = "audit_logs.cleanup.failed";
const CLEANUP_DISABLED_MESSAGE = "監査ログcleanupは無効です";
const CLEANUP_FAILED_MESSAGE = "監査ログcleanupの実行に失敗しました";
const INVALID_MAINTENANCE_TIME_MESSAGE = "監査ログ保守処理の基準時刻が不正です";

export const AUDIT_LOG_CLEANUP_BATCH_SIZE = 500;
export const AUDIT_LOG_CLEANUP_MAX_ROWS_PER_RUN = 10_000;
export const AUDIT_LOG_CLEANUP_MAX_DURATION_MS = 480_000;

export type AuditLogHealthSnapshot = Readonly<{
  createdLast24HoursCount: number;
  hasExpiredRows: boolean;
  oldestOccurredAt: Date | null;
  latestOccurredAt: Date | null;
}>;

export type AuditLogCleanupPreview = Readonly<{
  cutoff: Date;
  expiredCount: number;
  minimumRunsRequired: number;
}>;

export type CleanupAuditLogsResult = Readonly<{
  cutoff: Date;
  retentionDays: number;
  dryRun: boolean;
  skipped: boolean;
  deletedCount: number;
  durationMs: number;
  limitReached: boolean;
  healthBefore: AuditLogHealthSnapshot;
}>;

export type CleanupAuditLogsLogger = Pick<Console, "info" | "warn" | "error">;

export type CleanupAuditLogsOptions = Readonly<{
  now?: Date;
  dryRun?: boolean;
  logger?: CleanupAuditLogsLogger;
  config?: AuditLogRetentionConfig;
  getMonotonicTime?: () => number;
}>;

type AuditLogMaintenanceContext = Readonly<{
  now: Date;
  cutoff: Date;
  config: AuditLogRetentionConfig;
}>;

type CleanupLogFieldsInput = Pick<
  CleanupAuditLogsResult,
  | "cutoff"
  | "retentionDays"
  | "dryRun"
  | "deletedCount"
  | "durationMs"
  | "limitReached"
  | "healthBefore"
>;

export function calculateAuditLogCutoff(now: Date, retentionDays: number): Date {
  if (Number.isNaN(now.getTime())) {
    throw new Error(INVALID_MAINTENANCE_TIME_MESSAGE);
  }

  return new Date(now.getTime() - retentionDays * MILLISECONDS_PER_DAY);
}

function resolveMaintenanceContext(
  options: Pick<CleanupAuditLogsOptions, "now" | "config">,
): AuditLogMaintenanceContext {
  const now = options.now ?? new Date();
  const config = options.config ?? getAuditLogRetentionConfig();

  return {
    now,
    cutoff: calculateAuditLogCutoff(now, config.retentionDays),
    config,
  };
}

async function inspectAuditLogHealthAtCutoff(
  now: Date,
  cutoff: Date,
): Promise<AuditLogHealthSnapshot> {
  const last24HoursStart = new Date(now.getTime() - MILLISECONDS_PER_DAY);
  const [createdLast24HoursCount, oldestLog, latestLog, expiredLog] = await Promise.all([
    prisma.auditLog.count({
      where: { occurredAt: { gte: last24HoursStart } },
    }),
    prisma.auditLog.findFirst({
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { occurredAt: true },
    }),
    prisma.auditLog.findFirst({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { occurredAt: true },
    }),
    prisma.auditLog.findFirst({
      where: { occurredAt: { lt: cutoff } },
      select: { id: true },
    }),
  ]);

  return {
    createdLast24HoursCount,
    hasExpiredRows: expiredLog !== null,
    oldestOccurredAt: oldestLog?.occurredAt ?? null,
    latestOccurredAt: latestLog?.occurredAt ?? null,
  };
}

export async function inspectAuditLogHealth(
  options: Pick<CleanupAuditLogsOptions, "now" | "config"> = {},
): Promise<AuditLogHealthSnapshot> {
  const { now, cutoff } = resolveMaintenanceContext(options);
  return await inspectAuditLogHealthAtCutoff(now, cutoff);
}

async function previewExpiredAuditLogsAtCutoff(cutoff: Date): Promise<AuditLogCleanupPreview> {
  const expiredCount = await prisma.auditLog.count({
    where: { occurredAt: { lt: cutoff } },
  });

  return {
    cutoff,
    expiredCount,
    minimumRunsRequired: Math.ceil(expiredCount / AUDIT_LOG_CLEANUP_MAX_ROWS_PER_RUN),
  };
}

export async function previewExpiredAuditLogs(
  options: Pick<CleanupAuditLogsOptions, "now" | "config"> = {},
): Promise<AuditLogCleanupPreview> {
  const { cutoff } = resolveMaintenanceContext(options);
  return await previewExpiredAuditLogsAtCutoff(cutoff);
}

function toLogDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function createHealthLogFields(health: AuditLogHealthSnapshot) {
  return {
    createdLast24HoursCount: health.createdLast24HoursCount,
    hasExpiredRows: health.hasExpiredRows,
    oldestOccurredAt: toLogDate(health.oldestOccurredAt),
    latestOccurredAt: toLogDate(health.latestOccurredAt),
  };
}

function createCleanupLogFields(input: CleanupLogFieldsInput) {
  return {
    cutoff: input.cutoff.toISOString(),
    retentionDays: input.retentionDays,
    dryRun: input.dryRun,
    deletedCount: input.deletedCount,
    ...createHealthLogFields(input.healthBefore),
    durationMs: input.durationMs,
    limitReached: input.limitReached,
  };
}

async function hasExpiredAuditLogs(cutoff: Date): Promise<boolean> {
  const expiredLog = await prisma.auditLog.findFirst({
    where: { occurredAt: { lt: cutoff } },
    select: { id: true },
  });

  return expiredLog !== null;
}

export async function cleanupExpiredAuditLogs({
  now = new Date(),
  dryRun = false,
  logger = console,
  config = getAuditLogRetentionConfig(),
  getMonotonicTime = () => performance.now(),
}: CleanupAuditLogsOptions = {}): Promise<CleanupAuditLogsResult> {
  const startedAt = getMonotonicTime();
  let cutoff: Date | undefined;
  let deletedCount = 0;
  let healthBefore: AuditLogHealthSnapshot | undefined;

  const getDurationMs = (): number => Math.max(0, getMonotonicTime() - startedAt);

  try {
    cutoff = calculateAuditLogCutoff(now, config.retentionDays);
    healthBefore = await inspectAuditLogHealthAtCutoff(now, cutoff);

    if (dryRun) {
      const preview = await previewExpiredAuditLogsAtCutoff(cutoff);
      const durationMs = getDurationMs();
      const result = {
        cutoff,
        retentionDays: config.retentionDays,
        dryRun,
        skipped: false,
        deletedCount,
        durationMs,
        limitReached: false,
        healthBefore,
      } as const;

      logger.info({
        event: CLEANUP_PREVIEWED_EVENT,
        ...createCleanupLogFields(result),
        expiredCount: preview.expiredCount,
        minimumRunsRequired: preview.minimumRunsRequired,
      });

      return result;
    }

    if (!config.cleanupEnabled) {
      const durationMs = getDurationMs();
      const result = {
        cutoff,
        retentionDays: config.retentionDays,
        dryRun,
        skipped: true,
        deletedCount,
        durationMs,
        limitReached: false,
        healthBefore,
      } as const;

      logger.warn({
        event: CLEANUP_SKIPPED_EVENT,
        ...createCleanupLogFields(result),
        message: CLEANUP_DISABLED_MESSAGE,
      });

      return result;
    }

    let safetyLimitReached = false;

    while (healthBefore.hasExpiredRows && deletedCount < AUDIT_LOG_CLEANUP_MAX_ROWS_PER_RUN) {
      if (getDurationMs() >= AUDIT_LOG_CLEANUP_MAX_DURATION_MS) {
        safetyLimitReached = true;
        break;
      }

      const remainingRows = AUDIT_LOG_CLEANUP_MAX_ROWS_PER_RUN - deletedCount;
      const batchSize = Math.min(AUDIT_LOG_CLEANUP_BATCH_SIZE, remainingRows);
      const rows = await prisma.auditLog.findMany({
        where: { occurredAt: { lt: cutoff } },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: { id: true },
      });

      if (rows.length === 0) {
        break;
      }

      const deleteResult = await prisma.auditLog.deleteMany({
        where: {
          id: { in: rows.map((row) => row.id) },
          occurredAt: { lt: cutoff },
        },
      });
      deletedCount += deleteResult.count;

      if (rows.length < batchSize) {
        break;
      }
    }

    if (deletedCount >= AUDIT_LOG_CLEANUP_MAX_ROWS_PER_RUN) {
      safetyLimitReached = true;
    }

    const limitReached = safetyLimitReached ? await hasExpiredAuditLogs(cutoff) : false;
    const durationMs = getDurationMs();
    const result = {
      cutoff,
      retentionDays: config.retentionDays,
      dryRun,
      skipped: false,
      deletedCount,
      durationMs,
      limitReached,
      healthBefore,
    } as const;
    const logFields = createCleanupLogFields(result);

    if (limitReached) {
      logger.warn({
        event: CLEANUP_LIMIT_REACHED_EVENT,
        ...logFields,
      });
    } else {
      logger.info({
        event: CLEANUP_COMPLETED_EVENT,
        ...logFields,
      });
    }

    return result;
  } catch {
    const durationMs = getDurationMs();
    const healthLogFields = healthBefore ? createHealthLogFields(healthBefore) : {};

    logger.error({
      event: CLEANUP_FAILED_EVENT,
      ...(cutoff ? { cutoff: cutoff.toISOString() } : {}),
      retentionDays: config.retentionDays,
      dryRun,
      deletedCount,
      ...healthLogFields,
      durationMs,
      limitReached: false,
      message: CLEANUP_FAILED_MESSAGE,
    });
    throw new Error(CLEANUP_FAILED_MESSAGE);
  }
}
