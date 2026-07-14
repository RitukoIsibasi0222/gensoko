import { parseArgs } from "node:util";
import { getAuditLogRetentionConfig, type AuditLogRetentionConfig } from "../lib/config.js";
import type { CleanupAuditLogsResult } from "./cleanupAuditLogs.js";

const CLI_FAILED_EVENT = "audit_logs.cleanup.cli.failed";
const CLI_LIMIT_REACHED_EVENT = "audit_logs.cleanup.cli.limit_reached";
const CLI_DISCONNECT_FAILED_EVENT = "audit_logs.cleanup.cli.disconnect_failed";
const ARGUMENT_ERROR_MESSAGE = "監査ログcleanup CLIの引数が正しくありません";
const CLI_FAILED_MESSAGE = "監査ログcleanup CLIの実行に失敗しました";
const LIMIT_REACHED_MESSAGE = "監査ログcleanupの安全上限到達後も期限超過ログが残っています";
const DISCONNECT_FAILED_MESSAGE = "DB接続の終了処理に失敗しました";
const DISCONNECT_FAILED_AFTER_SUCCESS_MESSAGE =
  "監査ログcleanupの結果は確定済みですが、DB接続の終了処理に失敗しました。再実行せず接続状態を確認してください";

type CleanupAuditLogsCliExitCode = 0 | 1 | 2;

type CleanupAuditLogsRuntimeDependencies = Readonly<{
  cleanupExpiredAuditLogs: (options: {
    dryRun: boolean;
    config: AuditLogRetentionConfig;
  }) => Promise<CleanupAuditLogsResult>;
  disconnect: () => Promise<void>;
}>;

function parseDryRun(argv: readonly string[]): boolean {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      "dry-run": { type: "boolean" },
      execute: { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values["dry-run"] === true && values.execute === true) {
    throw new Error(ARGUMENT_ERROR_MESSAGE);
  }

  return values.execute !== true;
}

async function loadDependencies(): Promise<CleanupAuditLogsRuntimeDependencies> {
  const [{ cleanupExpiredAuditLogs }, { prisma }] = await Promise.all([
    import("./cleanupAuditLogs.js"),
    import("../lib/prisma.js"),
  ]);

  return {
    cleanupExpiredAuditLogs,
    disconnect: () => prisma.$disconnect(),
  };
}

function logFailure(message: string): void {
  console.error({
    event: CLI_FAILED_EVENT,
    message,
  });
}

export async function main(): Promise<void> {
  let dryRun: boolean;
  try {
    dryRun = parseDryRun(process.argv.slice(2));
  } catch {
    logFailure(ARGUMENT_ERROR_MESSAGE);
    process.exitCode = 2;
    return;
  }

  let config: AuditLogRetentionConfig;
  try {
    config = getAuditLogRetentionConfig();
  } catch (error) {
    logFailure(error instanceof Error ? error.message : CLI_FAILED_MESSAGE);
    process.exitCode = 2;
    return;
  }

  let dependencies: CleanupAuditLogsRuntimeDependencies;
  try {
    dependencies = await loadDependencies();
  } catch {
    logFailure(CLI_FAILED_MESSAGE);
    process.exitCode = 1;
    return;
  }

  let exitCode: CleanupAuditLogsCliExitCode = 0;

  try {
    const result = await dependencies.cleanupExpiredAuditLogs({ dryRun, config });

    if (result.limitReached) {
      console.error({
        event: CLI_LIMIT_REACHED_EVENT,
        message: LIMIT_REACHED_MESSAGE,
      });
      exitCode = 1;
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
