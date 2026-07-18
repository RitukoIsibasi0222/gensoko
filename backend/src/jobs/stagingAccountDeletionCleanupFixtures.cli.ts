import { parseArgs } from "node:util";

import type { StagingAccountDeletionCleanupFixtureClient } from "./stagingAccountDeletionCleanupFixtures.js";
import {
  prepareStagingAccountDeletionCleanupFixtures,
  removeStagingAccountDeletionCleanupFixtures,
  validateStagingAccountDeletionCleanupFixtureEnvironment,
  verifyStagingAccountDeletionCleanupFixtureIsolation,
  verifyStagingAccountDeletionCleanupFixturesWereCleaned,
} from "./stagingAccountDeletionCleanupFixtures.js";

const COMPLETED_EVENT = "account_data_deletion.staging_fixtures.completed";
const FAILED_EVENT = "account_data_deletion.staging_fixtures.failed";
const DISCONNECT_FAILED_EVENT = "account_data_deletion.staging_fixtures.disconnect_failed";
const ARGUMENT_ERROR_MESSAGE = "staging account deletion fixture CLIの引数が正しくありません";
const ENVIRONMENT_ERROR_MESSAGE = "staging account deletion fixture設定が不正です";
const EXECUTION_FAILED_MESSAGE = "staging account deletion fixture CLIの実行に失敗しました";
const DISCONNECT_FAILED_MESSAGE = "staging account deletion fixtureのDB接続終了に失敗しました";

type Operation = "prepare" | "verify-isolated" | "verify-cleaned" | "remove";

function parseOperation(argv: readonly string[]): Operation {
  const { values } = parseArgs({
    args: [...argv],
    options: { operation: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  if (
    values.operation !== "prepare" &&
    values.operation !== "verify-isolated" &&
    values.operation !== "verify-cleaned" &&
    values.operation !== "remove"
  ) {
    throw new Error(ARGUMENT_ERROR_MESSAGE);
  }
  return values.operation;
}

async function loadDependencies(): Promise<{
  client: StagingAccountDeletionCleanupFixtureClient;
  disconnect: () => Promise<void>;
}> {
  const { prisma } = await import("../lib/prisma.js");
  return {
    client: prisma as unknown as StagingAccountDeletionCleanupFixtureClient,
    disconnect: () => prisma.$disconnect(),
  };
}

export async function main(): Promise<void> {
  let operation: Operation;
  try {
    operation = parseOperation(process.argv.slice(2));
  } catch {
    console.error({ event: FAILED_EVENT, message: ARGUMENT_ERROR_MESSAGE });
    process.exitCode = 2;
    return;
  }

  try {
    validateStagingAccountDeletionCleanupFixtureEnvironment(process.env);
  } catch {
    console.error({ event: FAILED_EVENT, message: ENVIRONMENT_ERROR_MESSAGE });
    process.exitCode = 2;
    return;
  }

  let dependencies: Awaited<ReturnType<typeof loadDependencies>>;
  try {
    dependencies = await loadDependencies();
  } catch {
    console.error({ event: FAILED_EVENT, message: EXECUTION_FAILED_MESSAGE });
    process.exitCode = 1;
    return;
  }

  let exitCode = 0;
  try {
    const result =
      operation === "prepare"
        ? await prepareStagingAccountDeletionCleanupFixtures({ client: dependencies.client })
        : operation === "verify-isolated"
          ? await verifyStagingAccountDeletionCleanupFixtureIsolation({
              client: dependencies.client,
            })
          : operation === "verify-cleaned"
            ? await verifyStagingAccountDeletionCleanupFixturesWereCleaned({
                client: dependencies.client,
              })
            : await removeStagingAccountDeletionCleanupFixtures({ client: dependencies.client });
    console.info({ event: COMPLETED_EVENT, operation, ...result });
  } catch {
    console.error({ event: FAILED_EVENT, message: EXECUTION_FAILED_MESSAGE });
    exitCode = 1;
  }

  try {
    await dependencies.disconnect();
  } catch {
    console.warn({ event: DISCONNECT_FAILED_EVENT, message: DISCONNECT_FAILED_MESSAGE });
  }
  process.exitCode = exitCode;
}

void main();
