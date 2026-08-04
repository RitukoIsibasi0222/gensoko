import { pathToFileURL } from "node:url";

import { validateProductionDatabaseTarget } from "../lib/production-database-target.js";

const COMPLETED_EVENT = "production_database.target_validation.completed";
const FAILED_EVENT = "production_database.target_validation.failed";
const FAILED_MESSAGE = "production DB接続先の検証に失敗しました";

export function runValidateProductionDatabaseTargetCli(
  environment: Readonly<Record<string, string | undefined>>,
  logger: Pick<Console, "info" | "error"> = console,
): number {
  try {
    validateProductionDatabaseTarget(environment);
    logger.info({ event: COMPLETED_EVENT });
    return 0;
  } catch {
    logger.error({ event: FAILED_EVENT, message: FAILED_MESSAGE });
    return 2;
  }
}

function main(): void {
  process.exitCode = runValidateProductionDatabaseTargetCli(process.env);
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  main();
}
