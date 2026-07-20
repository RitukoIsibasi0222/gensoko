import { parseArgs } from "node:util";

import type { StagingSyntheticAdminE2eFixtureClient } from "./stagingSyntheticAdminE2eFixtures.js";
import {
  prepareStagingSyntheticAdminE2eFixtures,
  removeStagingSyntheticAdminE2eFixtures,
  validateStagingSyntheticAdminE2eFixtureEnvironment,
} from "./stagingSyntheticAdminE2eFixtures.js";

const COMPLETED_EVENT = "staging_synthetic_e2e.fixtures.completed";
const FAILED_EVENT = "staging_synthetic_e2e.fixtures.failed";
const DISCONNECT_FAILED_EVENT = "staging_synthetic_e2e.fixtures.disconnect_failed";
const ARGUMENT_ERROR_MESSAGE = "staging synthetic E2E fixture CLIの引数が正しくありません";
const ENVIRONMENT_ERROR_MESSAGE = "staging synthetic E2E fixture設定が不正です";
const EXECUTION_FAILED_MESSAGE = "staging synthetic E2E fixture CLIの実行に失敗しました";
const DISCONNECT_FAILED_MESSAGE = "staging synthetic E2E fixtureのDB接続終了に失敗しました";

type Operation = "prepare" | "remove";

function parseOperation(argv: readonly string[]): Operation {
  const { values } = parseArgs({
    args: [...argv],
    options: { operation: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  if (values.operation !== "prepare" && values.operation !== "remove") {
    throw new Error(ARGUMENT_ERROR_MESSAGE);
  }
  return values.operation;
}

async function loadDependencies(): Promise<{
  client: StagingSyntheticAdminE2eFixtureClient;
  disconnect: () => Promise<void>;
}> {
  const { prisma } = await import("../lib/prisma.js");
  return {
    client: prisma as unknown as StagingSyntheticAdminE2eFixtureClient,
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
    validateStagingSyntheticAdminE2eFixtureEnvironment(process.env, {
      requireCredentials: operation === "prepare",
    });
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
        ? await prepareStagingSyntheticAdminE2eFixtures({
            client: dependencies.client,
            adminPassword: process.env.STAGING_SYNTHETIC_ADMIN_PASSWORD ?? "",
            userPassword: process.env.STAGING_SYNTHETIC_USER_PASSWORD ?? "",
          })
        : await removeStagingSyntheticAdminE2eFixtures({ client: dependencies.client });
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

export const executionPromise = main();
