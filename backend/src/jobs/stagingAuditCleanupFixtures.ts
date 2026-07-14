import { MILLISECONDS_PER_DAY } from "../lib/time.js";

const INVALID_ENVIRONMENT_MESSAGE = "staging監査ログfixture設定が不正です";
const INVALID_TIME_MESSAGE = "staging監査ログfixtureの基準時刻が不正です";
const INVALID_RETENTION_MESSAGE = "staging監査ログfixtureの保持日数が不正です";
const PREPARATION_FAILED_MESSAGE = "staging監査ログfixtureの作成に失敗しました";
const VERIFICATION_FAILED_MESSAGE = "staging監査ログcleanup結果が正しくありません";

export const STAGING_EXPIRED_AUDIT_ACTION = "STAGING_AUDIT_CLEANUP_EXPIRED_FIXTURE";
export const STAGING_RETAINED_AUDIT_ACTION = "STAGING_AUDIT_CLEANUP_RETAINED_FIXTURE";

const STAGING_EXPIRED_AUDIT_ID = "staging-audit-cleanup-expired-fixture";
const STAGING_RETAINED_AUDIT_ID = "staging-audit-cleanup-retained-fixture";
const STAGING_FIXTURE_ACTIONS = [STAGING_EXPIRED_AUDIT_ACTION, STAGING_RETAINED_AUDIT_ACTION];

export type StagingAuditCleanupFixtureEnvironment = Readonly<{
  BATCH_ENVIRONMENT?: string;
  AUDIT_LOG_STAGING_FIXTURES_ENABLED?: string;
  STAGING_SUPABASE_PROJECT_REF?: string;
  DATABASE_URL?: string;
}>;

type StagingAuditLogFixtureRow = Readonly<{
  id: string;
  action: string;
  result: "SUCCESS";
  occurredAt: Date;
}>;

export type StagingAuditCleanupFixtureClient = Readonly<{
  auditLog: {
    deleteMany: (options: { where: { action: { in: string[] } } }) => Promise<{ count: number }>;
    createMany: (options: { data: StagingAuditLogFixtureRow[] }) => Promise<{ count: number }>;
    count: (options: { where: { action: string } }) => Promise<number>;
  };
}>;

export type StagingAuditCleanupFixtureCounts = Readonly<{
  expiredCount: number;
  retainedCount: number;
}>;

function createFixtureWhere() {
  return {
    action: {
      in: [...STAGING_FIXTURE_ACTIONS],
    },
  };
}

export function validateStagingAuditCleanupFixtureEnvironment(
  environment: StagingAuditCleanupFixtureEnvironment,
): void {
  try {
    const projectRef = environment.STAGING_SUPABASE_PROJECT_REF;
    const databaseUrl = new URL(environment.DATABASE_URL ?? "");

    if (
      environment.BATCH_ENVIRONMENT !== "staging" ||
      environment.AUDIT_LOG_STAGING_FIXTURES_ENABLED !== "true" ||
      !projectRef ||
      databaseUrl.protocol !== "postgresql:" ||
      databaseUrl.username !== `postgres.${projectRef}` ||
      !databaseUrl.hostname.endsWith(".pooler.supabase.com") ||
      databaseUrl.port !== "5432" ||
      databaseUrl.pathname !== "/postgres"
    ) {
      throw new Error(INVALID_ENVIRONMENT_MESSAGE);
    }
  } catch {
    throw new Error(INVALID_ENVIRONMENT_MESSAGE);
  }
}

export async function prepareStagingAuditCleanupFixtures({
  client,
  now,
  retentionDays,
}: {
  client: StagingAuditCleanupFixtureClient;
  now: Date;
  retentionDays: number;
}): Promise<StagingAuditCleanupFixtureCounts> {
  if (Number.isNaN(now.getTime())) {
    throw new Error(INVALID_TIME_MESSAGE);
  }

  if (!Number.isInteger(retentionDays) || retentionDays < 2) {
    throw new Error(INVALID_RETENTION_MESSAGE);
  }

  await client.auditLog.deleteMany({ where: createFixtureWhere() });

  const createResult = await client.auditLog.createMany({
    data: [
      {
        id: STAGING_EXPIRED_AUDIT_ID,
        action: STAGING_EXPIRED_AUDIT_ACTION,
        result: "SUCCESS",
        occurredAt: new Date(now.getTime() - (retentionDays + 1) * MILLISECONDS_PER_DAY),
      },
      {
        id: STAGING_RETAINED_AUDIT_ID,
        action: STAGING_RETAINED_AUDIT_ACTION,
        result: "SUCCESS",
        occurredAt: new Date(now.getTime() - (retentionDays - 1) * MILLISECONDS_PER_DAY),
      },
    ],
  });

  if (createResult.count !== 2) {
    throw new Error(PREPARATION_FAILED_MESSAGE);
  }

  return { expiredCount: 1, retainedCount: 1 };
}

export async function verifyStagingAuditCleanupFixturesWereCleaned({
  client,
}: {
  client: StagingAuditCleanupFixtureClient;
}): Promise<StagingAuditCleanupFixtureCounts> {
  const [expiredCount, retainedCount] = await Promise.all([
    client.auditLog.count({ where: { action: STAGING_EXPIRED_AUDIT_ACTION } }),
    client.auditLog.count({ where: { action: STAGING_RETAINED_AUDIT_ACTION } }),
  ]);

  if (expiredCount !== 0 || retainedCount !== 1) {
    throw new Error(VERIFICATION_FAILED_MESSAGE);
  }

  return { expiredCount, retainedCount };
}

export async function removeStagingAuditCleanupFixtures({
  client,
}: {
  client: StagingAuditCleanupFixtureClient;
}): Promise<{ deletedCount: number }> {
  const result = await client.auditLog.deleteMany({ where: createFixtureWhere() });
  return { deletedCount: result.count };
}
