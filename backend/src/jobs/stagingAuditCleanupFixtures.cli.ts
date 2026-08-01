import { parseArgs } from "node:util";
import { getAuditLogRetentionConfig } from "../lib/config.js";
import type { StagingAuditCleanupFixtureClient } from "./stagingAuditCleanupFixtures.js";
import {
  prepareStagingAuditCleanupFixtures,
  removeStagingAuditCleanupFixtures,
  validateStagingAuditCleanupFixtureEnvironment,
  verifyStagingAuditCleanupFixturesWereCleaned,
} from "./stagingAuditCleanupFixtures.js";

const COMPLETED_EVENT = "audit_logs.cleanup.staging_fixtures.completed";
const FAILED_EVENT = "audit_logs.cleanup.staging_fixtures.failed";
const DISCONNECT_FAILED_EVENT = "audit_logs.cleanup.staging_fixtures.disconnect_failed";
const ARGUMENT_ERROR_MESSAGE = "staging監査ログfixture CLIの引数が正しくありません";
const ENVIRONMENT_ERROR_MESSAGE = "staging監査ログfixture設定が不正です";
const EXECUTION_FAILED_MESSAGE = "staging監査ログfixture CLIの実行に失敗しました";
const DISCONNECT_FAILED_MESSAGE = "staging監査ログfixtureのDB接続終了に失敗しました";

type StagingFixtureOperation = "prepare" | "verify-cleaned" | "remove";

function parseOperation(argv: readonly string[]): StagingFixtureOperation {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      operation: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (
    values.operation !== "prepare" &&
    values.operation !== "verify-cleaned" &&
    values.operation !== "remove"
  ) {
    throw new Error(ARGUMENT_ERROR_MESSAGE);
  }

  return values.operation;
}

async function loadDependencies(): Promise<{
  client: StagingAuditCleanupFixtureClient;
  disconnect: () => Promise<void>;
}> {
  const { prisma } = await import("../lib/prisma.js");

  return {
    client: {
      auditLog: {
        deleteMany: (options) => prisma.auditLog.deleteMany(options),
        createMany: (options) => prisma.auditLog.createMany(options),
        count: (options) => prisma.auditLog.count(options),
      },
    },
    disconnect: () => prisma.$disconnect(),
  };
}

function logFailure(message: string): void {
  console.error({ event: FAILED_EVENT, message });
}

export async function main(): Promise<void> {
  let operation: StagingFixtureOperation;
  try {
    operation = parseOperation(process.argv.slice(2));
  } catch {
    logFailure(ARGUMENT_ERROR_MESSAGE);
    process.exitCode = 2;
    return;
  }

  try {
    validateStagingAuditCleanupFixtureEnvironment(process.env);
  } catch {
    logFailure(ENVIRONMENT_ERROR_MESSAGE);
    process.exitCode = 2;
    return;
  }

  let retentionDays: number;
  try {
    retentionDays = getAuditLogRetentionConfig().retentionDays;
  } catch {
    logFailure(EXECUTION_FAILED_MESSAGE);
    process.exitCode = 2;
    return;
  }

  let dependencies: Awaited<ReturnType<typeof loadDependencies>>;
  try {
    dependencies = await loadDependencies();
  } catch {
    logFailure(EXECUTION_FAILED_MESSAGE);
    process.exitCode = 1;
    return;
  }

  let exitCode = 0;

  try {
    const result =
      operation === "prepare"
        ? await prepareStagingAuditCleanupFixtures({
            client: dependencies.client,
            now: new Date(),
            retentionDays,
          })
        : operation === "verify-cleaned"
          ? await verifyStagingAuditCleanupFixturesWereCleaned({
              client: dependencies.client,
            })
          : await removeStagingAuditCleanupFixtures({ client: dependencies.client });

    console.info({
      event: COMPLETED_EVENT,
      operation,
      ...result,
    });
  } catch {
    logFailure(EXECUTION_FAILED_MESSAGE);
    exitCode = 1;
  }

  try {
    await dependencies.disconnect();
  } catch {
    console.warn({
      event: DISCONNECT_FAILED_EVENT,
      message: DISCONNECT_FAILED_MESSAGE,
    });
  }

  process.exitCode = exitCode;
}

void main();
