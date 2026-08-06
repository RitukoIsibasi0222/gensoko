import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  classifyProductionMigrationStatus,
  type ProductionMigrationGateStatus,
  type ProductionMigrationStatusInput,
} from "./productionMigrationGate.js";

const STATUS_TIMEOUT_MS = 120_000;
const FAILED_MESSAGE = "production migration状態を安全に確認できませんでした";
const PENDING_MESSAGE =
  "pending migrationがあります。Production Database Operationsの承認付きmigrate-deployを完了してから再実行してください";

type SafeLogger = (value: Readonly<Record<string, string>>) => void;

async function runPrismaMigrationStatus(): Promise<ProductionMigrationStatusInput> {
  const tempRoot = process.env.RUNNER_TEMP ?? tmpdir();
  const suffix = `${process.pid}-${Date.now()}`;
  const stdoutPath = join(tempRoot, `production-migration-status-${suffix}.out`);
  const stderrPath = join(tempRoot, `production-migration-status-${suffix}.err`);
  const stdoutDescriptor = openSync(stdoutPath, "w", 0o600);
  const stderrDescriptor = openSync(stderrPath, "w", 0o600);

  try {
    const result = spawnSync("npx", ["prisma", "migrate", "status"], {
      stdio: ["ignore", stdoutDescriptor, stderrDescriptor],
      timeout: STATUS_TIMEOUT_MS,
    });
    return {
      exitCode: result.status,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8"),
      timedOut: result.error?.name === "ETIMEDOUT" || result.signal === "SIGTERM",
    };
  } finally {
    closeSync(stdoutDescriptor);
    closeSync(stderrDescriptor);
    rmSync(stdoutPath, { force: true });
    rmSync(stderrPath, { force: true });
  }
}

export async function runProductionMigrationGateCli({
  runStatus = runPrismaMigrationStatus,
  info = console.info,
  error = console.error,
}: Readonly<{
  runStatus?: () => Promise<ProductionMigrationStatusInput>;
  info?: SafeLogger;
  error?: SafeLogger;
}> = {}): Promise<0 | 1> {
  let status: ProductionMigrationGateStatus;
  try {
    status = classifyProductionMigrationStatus(await runStatus());
  } catch {
    status = "unknown";
  }

  if (status === "current") {
    info({ event: "production_migration_gate.completed", status });
    return 0;
  }
  error({
    event: "production_migration_gate.failed",
    status,
    message: status === "pending" ? PENDING_MESSAGE : FAILED_MESSAGE,
  });
  return 1;
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  process.exitCode = await runProductionMigrationGateCli();
}
