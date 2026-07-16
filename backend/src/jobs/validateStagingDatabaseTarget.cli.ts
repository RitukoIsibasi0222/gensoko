import { pathToFileURL } from "node:url";

import { validateStagingDatabaseTarget } from "../lib/staging-database-target.js";

const COMPLETED_EVENT = "staging_database.target_validation.completed";
const FAILED_EVENT = "staging_database.target_validation.failed";
const FAILED_MESSAGE = "staging DB接続先の検証に失敗しました";

export function runValidateStagingDatabaseTargetCli(
  environment: Readonly<Record<string, string | undefined>>,
  logger: Pick<Console, "info" | "error"> = console,
): number {
  try {
    validateStagingDatabaseTarget(environment);
    logger.info({ event: COMPLETED_EVENT });
    return 0;
  } catch {
    logger.error({ event: FAILED_EVENT, message: FAILED_MESSAGE });
    return 2;
  }
}

function main(): void {
  process.exitCode = runValidateStagingDatabaseTargetCli(process.env);
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  main();
}
