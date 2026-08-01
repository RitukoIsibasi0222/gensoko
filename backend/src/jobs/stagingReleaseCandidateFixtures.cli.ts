import { parseArgs } from "node:util";

import {
  armM2EmailVerification,
  preflightM2StagingFixture,
  removeM2StagingFixture,
  validateM2StagingFixtureEnvironment,
  type M2StagingFixtureClient,
  type M2StagingFixtureEnvironment,
} from "./stagingReleaseCandidateFixtures.js";

const COMPLETED_EVENT = "m2_staging_fixture.completed";
const FAILED_EVENT = "m2_staging_fixture.failed";
const ARGUMENT_ERROR_MESSAGE = "M2 staging fixture CLIの引数が正しくありません";
const ENVIRONMENT_ERROR_MESSAGE = "M2 staging fixture設定が不正です";
const EXECUTION_ERROR_MESSAGE = "M2 staging fixture CLIの実行に失敗しました";

type Operation = "preflight" | "arm-verification" | "cleanup";
type SafeLogger = (value: Readonly<Record<string, string>>) => void;

type FixtureCliDependencies = Readonly<{
  client: M2StagingFixtureClient;
  disconnect: () => Promise<void>;
}>;

function parseOperation(argv: readonly string[]): Operation {
  const { values } = parseArgs({
    args: [...argv],
    options: { operation: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  if (
    values.operation !== "preflight" &&
    values.operation !== "arm-verification" &&
    values.operation !== "cleanup"
  ) {
    throw new Error(ARGUMENT_ERROR_MESSAGE);
  }
  return values.operation;
}

async function loadDefaultDependencies(): Promise<FixtureCliDependencies> {
  const { prisma } = await import("../lib/prisma.js");
  return {
    client: prisma as unknown as M2StagingFixtureClient,
    disconnect: async () => await prisma.$disconnect(),
  };
}

export async function runM2StagingFixtureCli({
  argv,
  environment,
  info = console.info,
  error = console.error,
  loadDependencies = loadDefaultDependencies,
  now = () => new Date(),
}: {
  argv: readonly string[];
  environment: M2StagingFixtureEnvironment & Readonly<{ M2_VERIFICATION_TOKEN?: string }>;
  info?: SafeLogger;
  error?: SafeLogger;
  loadDependencies?: () => Promise<FixtureCliDependencies>;
  now?: () => Date;
}): Promise<0 | 1 | 2> {
  let operation: Operation;
  try {
    operation = parseOperation(argv);
  } catch {
    error({ event: FAILED_EVENT, message: ARGUMENT_ERROR_MESSAGE });
    return 2;
  }

  try {
    validateM2StagingFixtureEnvironment(environment);
  } catch {
    error({ event: FAILED_EVENT, message: ENVIRONMENT_ERROR_MESSAGE });
    return 2;
  }

  let dependencies: FixtureCliDependencies;
  try {
    dependencies = await loadDependencies();
  } catch {
    error({ event: FAILED_EVENT, message: EXECUTION_ERROR_MESSAGE });
    return 1;
  }

  try {
    const result =
      operation === "preflight"
        ? await preflightM2StagingFixture({ client: dependencies.client })
        : operation === "arm-verification"
          ? await armM2EmailVerification({
              client: dependencies.client,
              token: environment.M2_VERIFICATION_TOKEN ?? "",
              expiresAt: new Date(now().getTime() + 60 * 60 * 1_000),
            })
          : await removeM2StagingFixture({ client: dependencies.client });
    info({ event: COMPLETED_EVENT, operation, status: result.status });
    return 0;
  } catch {
    error({ event: FAILED_EVENT, message: EXECUTION_ERROR_MESSAGE });
    return 1;
  } finally {
    try {
      await dependencies.disconnect();
    } catch {
      // DB切断失敗で安全なoperation結果や固定errorを秘密値へ置き換えない
    }
  }
}

export async function main(): Promise<void> {
  process.exitCode = await runM2StagingFixtureCli({
    argv: process.argv.slice(2),
    environment: process.env,
  });
}

if (process.env.NODE_ENV !== "test") {
  void main();
}
