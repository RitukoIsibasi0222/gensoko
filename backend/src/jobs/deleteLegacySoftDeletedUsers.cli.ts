import { getAccountDataDeletionConfig, type AccountDataDeletionConfig } from "../lib/config.js";
import type {
  DeleteLegacySoftDeletedUsersInput,
  DeleteLegacySoftDeletedUsersResult,
} from "./deleteLegacySoftDeletedUsers.js";
import {
  STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE,
  validateStagingAccountDeletionCleanupFixtureEnvironment,
} from "./stagingAccountDeletionCleanupFixtures.js";

const CONFIRMATION = "DELETE_LEGACY_SOFT_DELETED_USERS";
const CLI_FAILED_EVENT = "account_data_deletion.legacy_cleanup.cli.failed";
const CLI_REMAINING_USERS_EVENT = "account_data_deletion.legacy_cleanup.cli.remaining_users";
const CLI_DISCONNECT_FAILED_EVENT = "account_data_deletion.legacy_cleanup.cli.disconnect_failed";
const ARGUMENT_ERROR_MESSAGE = "既存退会済みユーザーcleanup CLIの引数が正しくありません";
const EXECUTE_GATE_ERROR_MESSAGE = "既存退会済みユーザーcleanupの実行条件が満たされていません";
const CLI_FAILED_MESSAGE = "既存退会済みユーザーcleanup CLIの実行に失敗しました";
const REMAINING_USERS_MESSAGE = "既存退会済みユーザーが残っています";
const DISCONNECT_FAILED_MESSAGE = "DB接続の終了処理に失敗しました";
const DISCONNECT_FAILED_AFTER_SUCCESS_MESSAGE =
  "cleanup結果は確定済みですが、DB接続の終了処理に失敗しました。再実行せず接続状態を確認してください";

type CleanupCliExitCode = 0 | 1 | 2;

type ParsedArguments = Readonly<{
  execute: boolean;
  confirmation?: string;
  stagingSyntheticOnly: boolean;
}>;

type CleanupRuntimeDependencies = Readonly<{
  deleteLegacySoftDeletedUsers: (
    input: DeleteLegacySoftDeletedUsersInput,
  ) => Promise<DeleteLegacySoftDeletedUsersResult>;
  disconnect: () => Promise<void>;
}>;

function parseArguments(argv: readonly string[]): ParsedArguments {
  let execute = false;
  let confirmation: string | undefined;
  let stagingSyntheticOnly = false;

  for (const argument of argv) {
    if (argument === "--execute") {
      if (execute) {
        throw new Error(ARGUMENT_ERROR_MESSAGE);
      }
      execute = true;
      continue;
    }

    if (argument.startsWith("--confirm=")) {
      if (confirmation !== undefined) {
        throw new Error(ARGUMENT_ERROR_MESSAGE);
      }
      confirmation = argument.slice("--confirm=".length);
      continue;
    }

    if (argument === "--staging-synthetic-only") {
      if (stagingSyntheticOnly) {
        throw new Error(ARGUMENT_ERROR_MESSAGE);
      }
      stagingSyntheticOnly = true;
      continue;
    }

    throw new Error(ARGUMENT_ERROR_MESSAGE);
  }

  return { execute, confirmation, stagingSyntheticOnly };
}

function validateExecuteGate(arguments_: ParsedArguments, config: AccountDataDeletionConfig): void {
  if (!arguments_.execute) {
    if (arguments_.confirmation !== undefined || arguments_.stagingSyntheticOnly) {
      throw new Error(EXECUTE_GATE_ERROR_MESSAGE);
    }
    return;
  }

  if (!config.executeEnabled || arguments_.confirmation !== CONFIRMATION) {
    throw new Error(EXECUTE_GATE_ERROR_MESSAGE);
  }

  if (arguments_.stagingSyntheticOnly) {
    validateStagingAccountDeletionCleanupFixtureEnvironment(process.env);
  }
}

async function loadDependencies(): Promise<CleanupRuntimeDependencies> {
  const [{ deleteLegacySoftDeletedUsers }, { prisma }] = await Promise.all([
    import("./deleteLegacySoftDeletedUsers.js"),
    import("../lib/prisma.js"),
  ]);

  return {
    deleteLegacySoftDeletedUsers,
    disconnect: () => prisma.$disconnect(),
  };
}

function logFailure(message: string): void {
  console.error({
    event: CLI_FAILED_EVENT,
    message,
  });
}

function hasRemainingUsers(
  executeResult: DeleteLegacySoftDeletedUsersResult,
  verificationResult: DeleteLegacySoftDeletedUsersResult,
): boolean {
  return (
    executeResult.remainingUsers > 0 ||
    verificationResult.matchedUsers > 0 ||
    verificationResult.remainingUsers > 0
  );
}

export async function main(): Promise<void> {
  let arguments_: ParsedArguments;
  try {
    arguments_ = parseArguments(process.argv.slice(2));
  } catch {
    logFailure(ARGUMENT_ERROR_MESSAGE);
    process.exitCode = 2;
    return;
  }

  let config: AccountDataDeletionConfig;
  try {
    config = getAccountDataDeletionConfig();
  } catch (error) {
    logFailure(error instanceof Error ? error.message : CLI_FAILED_MESSAGE);
    process.exitCode = 2;
    return;
  }

  try {
    validateExecuteGate(arguments_, config);
  } catch {
    logFailure(EXECUTE_GATE_ERROR_MESSAGE);
    process.exitCode = 2;
    return;
  }

  let dependencies: CleanupRuntimeDependencies;
  try {
    dependencies = await loadDependencies();
  } catch {
    logFailure(CLI_FAILED_MESSAGE);
    process.exitCode = 1;
    return;
  }

  let exitCode: CleanupCliExitCode = 0;

  try {
    if (!arguments_.execute) {
      await dependencies.deleteLegacySoftDeletedUsers({
        mode: "dry-run",
        batchSize: config.batchSize,
      });
    } else {
      const executeResult = await dependencies.deleteLegacySoftDeletedUsers({
        mode: "execute",
        batchSize: config.batchSize,
        ...(arguments_.stagingSyntheticOnly
          ? { deleteOnlyUserIds: [STAGING_ACCOUNT_DELETION_LEGACY_FIXTURE.id] }
          : {}),
      });
      const verificationResult = await dependencies.deleteLegacySoftDeletedUsers({
        mode: "dry-run",
        batchSize: config.batchSize,
      });

      if (hasRemainingUsers(executeResult, verificationResult)) {
        console.error({
          event: CLI_REMAINING_USERS_EVENT,
          message: REMAINING_USERS_MESSAGE,
        });
        exitCode = 1;
      }
    }
  } catch {
    logFailure(CLI_FAILED_MESSAGE);
    exitCode = 1;
  }

  try {
    await dependencies.disconnect();
  } catch {
    console.warn({
      event: CLI_DISCONNECT_FAILED_EVENT,
      message: exitCode === 0 ? DISCONNECT_FAILED_AFTER_SUCCESS_MESSAGE : DISCONNECT_FAILED_MESSAGE,
    });
  }

  process.exitCode = exitCode;
}

void main();
