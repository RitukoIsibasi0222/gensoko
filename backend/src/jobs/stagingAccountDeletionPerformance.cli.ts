import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { getStagingAccountDeletionPerformanceConfig } from "../lib/config.js";
import { validateStagingDatabaseTarget } from "../lib/staging-database-target.js";
import {
  MAX_STAGING_PERFORMANCE_ANSWER_COUNT,
  MAX_STAGING_PERFORMANCE_SESSION_COUNT,
  StagingAccountDeletionPerformanceFailure,
  cleanupStagingAccountDeletionFixture,
  createStagingAccountDeletionFixture,
  getStagingAccountDeletionPreview,
  probeStagingAccountDeletionFixtureWrites,
  runStagingAccountDeletionMigrationWriteProbe,
  runStagingAccountDeletionPerformance,
  verifyStagingAccountDeletionFixtureDeleted,
  type StagingAccountDeletionPerformanceInput,
  type StagingAccountDeletionPerformanceResult,
  type StagingAccountDeletionPreview,
} from "./stagingAccountDeletionPerformance.js";

const COMPLETED_EVENT = "account_deletion.performance.completed";
const FAILED_EVENT = "account_deletion.performance.failed";
const DISCONNECT_FAILED_EVENT = "account_deletion.performance.disconnect_failed";
const ARGUMENT_ERROR_MESSAGE = "staging account deletion性能測定CLIの引数が正しくありません";
const CONFIGURATION_ERROR_MESSAGE = "staging account deletion性能測定の環境設定が不正です";
const ENVIRONMENT_ERROR_MESSAGE = "staging account deletion性能測定の接続先が不正です";
const EXECUTION_FAILED_MESSAGE = "staging account deletion性能測定に失敗しました";
const DISCONNECT_FAILED_MESSAGE = "staging account deletion性能測定のDB接続終了に失敗しました";
const EXECUTE_CONFIRMATION = "MEASURE_STAGING_ACCOUNT_DELETION";
const MIGRATION_PROBE_CONFIRMATION = "MEASURE_STAGING_ACCOUNT_DELETION_MIGRATION";

type CliMode =
  | { mode: "preview" }
  | ({ mode: "execute" } & StagingAccountDeletionPerformanceInput)
  | { mode: "migration-write-probe"; durationMs: number };

type PerformanceRuntime = Readonly<{
  preview: () => Promise<StagingAccountDeletionPreview>;
  execute: (
    input: StagingAccountDeletionPerformanceInput,
  ) => Promise<StagingAccountDeletionPerformanceResult>;
  probeMigrationWrites?: (durationMs: number) => Promise<{
    probeCount: number;
    writeProbeMaxDurationMs: number;
    fixtureCleanupStatus: "completed";
  }>;
  disconnect: () => Promise<void>;
}>;

type CliDependencies = Readonly<{
  validateEnvironment: (environment: Readonly<Record<string, string | undefined>>) => void;
  getPerformanceConfig: (environment: Readonly<Record<string, string | undefined>>) => {
    executeEnabled: boolean;
  };
  loadRuntime: () => Promise<PerformanceRuntime>;
  info: (value: unknown) => void;
  error: (value: unknown) => void;
  warn: (value: unknown) => void;
}>;

function parseStrictInteger(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(ARGUMENT_ERROR_MESSAGE);
  }
  return Number(value);
}

function parseIntegerInRange(value: string | undefined, minimum: number, maximum: number): number {
  const parsed = parseStrictInteger(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(ARGUMENT_ERROR_MESSAGE);
  }
  return parsed;
}

function rejectDuplicateOptions(argv: readonly string[]): void {
  const seen = new Set<string>();
  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      continue;
    }
    const optionName = argument.split("=", 1)[0];
    if (seen.has(optionName)) {
      throw new Error(ARGUMENT_ERROR_MESSAGE);
    }
    seen.add(optionName);
  }
}

function parseCliMode(argv: readonly string[], executeEnabled: boolean): CliMode {
  rejectDuplicateOptions(argv);
  const { values } = parseArgs({
    args: [...argv],
    options: {
      execute: { type: "boolean" },
      "migration-write-probe": { type: "boolean" },
      confirm: { type: "string" },
      "session-count": { type: "string" },
      "answer-count": { type: "string" },
      "platform-request-timeout-ms": { type: "string" },
      "probe-duration-ms": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.execute && values["migration-write-probe"]) {
    throw new Error(ARGUMENT_ERROR_MESSAGE);
  }

  if (values.execute) {
    if (
      !executeEnabled ||
      values.confirm !== EXECUTE_CONFIRMATION ||
      values["probe-duration-ms"] !== undefined
    ) {
      throw new Error(ARGUMENT_ERROR_MESSAGE);
    }
    return {
      mode: "execute",
      sessionCount: parseIntegerInRange(
        values["session-count"],
        1,
        MAX_STAGING_PERFORMANCE_SESSION_COUNT,
      ),
      answerCount: parseIntegerInRange(
        values["answer-count"],
        0,
        MAX_STAGING_PERFORMANCE_ANSWER_COUNT,
      ),
      platformRequestTimeoutMs: parseIntegerInRange(
        values["platform-request-timeout-ms"],
        1_000,
        120_000,
      ),
    };
  }

  if (values["migration-write-probe"]) {
    if (
      !executeEnabled ||
      values.confirm !== MIGRATION_PROBE_CONFIRMATION ||
      values["session-count"] !== undefined ||
      values["answer-count"] !== undefined ||
      values["platform-request-timeout-ms"] !== undefined
    ) {
      throw new Error(ARGUMENT_ERROR_MESSAGE);
    }
    return {
      mode: "migration-write-probe",
      durationMs: parseIntegerInRange(values["probe-duration-ms"], 5_000, 120_000),
    };
  }

  if (
    values.confirm !== undefined ||
    values["session-count"] !== undefined ||
    values["answer-count"] !== undefined ||
    values["platform-request-timeout-ms"] !== undefined ||
    values["probe-duration-ms"] !== undefined
  ) {
    throw new Error(ARGUMENT_ERROR_MESSAGE);
  }
  return { mode: "preview" };
}

async function loadRuntime(): Promise<PerformanceRuntime> {
  const [{ prisma }, { createUserService }, { createSerializableTransactionRunner }] =
    await Promise.all([
      import("../lib/prisma.js"),
      import("../services/user.service.js"),
      import("../lib/serializable-transaction-core.js"),
    ]);
  const { deleteCurrentUser } = createUserService({
    prisma,
    runSerializableTransaction: createSerializableTransactionRunner(prisma),
  });

  const preview = () =>
    getStagingAccountDeletionPreview({
      user: {
        findMany: (options) => prisma.user.findMany(options),
        count: (options) => prisma.user.count(options),
      },
      element: { count: () => prisma.element.count() },
    });

  return {
    preview,
    execute: (input) =>
      runStagingAccountDeletionPerformance(input, {
        preview,
        createFixture: (counts) => createStagingAccountDeletionFixture(prisma, counts),
        deleteCurrentUser,
        verifyFixtureDeleted: (userId) =>
          verifyStagingAccountDeletionFixtureDeleted(prisma, userId),
        cleanupFixture: (userId) => cleanupStagingAccountDeletionFixture(prisma, userId),
        getMonotonicTime: () => performance.now(),
      }),
    probeMigrationWrites: (durationMs) =>
      runStagingAccountDeletionMigrationWriteProbe(durationMs, {
        createFixture: () =>
          createStagingAccountDeletionFixture(prisma, { sessionCount: 1, answerCount: 1 }),
        probeOnce: (userId) => probeStagingAccountDeletionFixtureWrites(prisma, userId),
        cleanupFixture: (userId) => cleanupStagingAccountDeletionFixture(prisma, userId),
        getMonotonicTime: () => performance.now(),
        wait: (waitMs) => new Promise((resolve) => setTimeout(resolve, waitMs)),
      }),
    disconnect: () => prisma.$disconnect(),
  };
}

const defaultDependencies: CliDependencies = {
  validateEnvironment: validateStagingDatabaseTarget,
  getPerformanceConfig: (environment) =>
    getStagingAccountDeletionPerformanceConfig({ environment }),
  loadRuntime,
  info: (value) => console.info(JSON.stringify(value)),
  error: (value) => console.error(JSON.stringify(value)),
  warn: (value) => console.warn(JSON.stringify(value)),
};

export async function runStagingAccountDeletionPerformanceCli({
  argv,
  environment,
  dependencies = defaultDependencies,
}: {
  argv: readonly string[];
  environment: Readonly<Record<string, string | undefined>>;
  dependencies?: CliDependencies;
}): Promise<number> {
  let executeEnabled: boolean;
  try {
    const config = dependencies.getPerformanceConfig(environment);
    executeEnabled = config.executeEnabled;
  } catch {
    dependencies.error({ event: FAILED_EVENT, message: CONFIGURATION_ERROR_MESSAGE });
    return 2;
  }

  let mode: CliMode;
  try {
    mode = parseCliMode(argv, executeEnabled);
  } catch {
    dependencies.error({ event: FAILED_EVENT, message: ARGUMENT_ERROR_MESSAGE });
    return 2;
  }

  try {
    dependencies.validateEnvironment(environment);
  } catch {
    dependencies.error({ event: FAILED_EVENT, message: ENVIRONMENT_ERROR_MESSAGE });
    return 2;
  }

  let runtime: PerformanceRuntime;
  try {
    runtime = await dependencies.loadRuntime();
  } catch {
    dependencies.error({ event: FAILED_EVENT, message: EXECUTION_FAILED_MESSAGE });
    return 1;
  }

  let exitCode = 0;
  try {
    const result =
      mode.mode === "preview"
        ? await runtime.preview()
        : mode.mode === "execute"
          ? await runtime.execute({
              sessionCount: mode.sessionCount,
              answerCount: mode.answerCount,
              platformRequestTimeoutMs: mode.platformRequestTimeoutMs,
            })
          : await runtime.probeMigrationWrites?.(mode.durationMs);

    if (!result) {
      throw new Error(EXECUTION_FAILED_MESSAGE);
    }
    dependencies.info({ event: COMPLETED_EVENT, mode: mode.mode, ...result });
  } catch (error) {
    const cleanupDetails =
      error instanceof StagingAccountDeletionPerformanceFailure
        ? {
            mode: mode.mode,
            fixtureCleanupStatus: error.fixtureCleanupStatus,
          }
        : {};
    dependencies.error({
      event: FAILED_EVENT,
      ...cleanupDetails,
      message: EXECUTION_FAILED_MESSAGE,
    });
    exitCode = 1;
  }

  try {
    await runtime.disconnect();
  } catch {
    dependencies.warn({
      event: DISCONNECT_FAILED_EVENT,
      message: DISCONNECT_FAILED_MESSAGE,
    });
  }
  return exitCode;
}

async function main(): Promise<void> {
  process.exitCode = await runStagingAccountDeletionPerformanceCli({
    argv: process.argv.slice(2),
    environment: process.env,
  });
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  void main();
}
