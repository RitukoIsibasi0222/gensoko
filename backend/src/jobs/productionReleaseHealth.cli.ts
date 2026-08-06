import { pathToFileURL } from "node:url";

import { validateProductionReleaseHealth } from "./productionReleaseHealth.js";

export async function runProductionReleaseHealthCli(
  environment: Readonly<Record<string, string | undefined>>,
  logger: Pick<Console, "info" | "error"> = console,
): Promise<0 | 1> {
  try {
    await validateProductionReleaseHealth({
      apiBaseUrl: environment.PRODUCTION_API_BASE_URL ?? "",
      frontendOrigin: environment.PRODUCTION_FRONTEND_ORIGIN ?? "",
    });
    logger.info({ event: "production_release_health.completed", status: "clear" });
    return 0;
  } catch {
    logger.error({
      event: "production_release_health.failed",
      message: "production API health確認に失敗しました",
    });
    return 1;
  }
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  process.exitCode = await runProductionReleaseHealthCli(process.env);
}
