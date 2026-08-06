import { pathToFileURL } from "node:url";

import { runProductionWorkerDeployment } from "../lib/production-worker-deployment.js";

export function runProductionWorkerDeploymentCli(
  environment: Readonly<Record<string, string | undefined>>,
  logger: Pick<Console, "info" | "error"> = console,
): 0 | 1 {
  try {
    runProductionWorkerDeployment({
      expectedSha: environment.GITHUB_SHA ?? "",
      environment,
      stagingConfigPath: "wrangler.jsonc",
      workingDirectory: process.cwd(),
    });
    logger.info({ event: "production_worker_deployment.completed", status: "deployed" });
    return 0;
  } catch {
    logger.error({
      event: "production_worker_deployment.failed",
      message: "production Worker deployを安全に完了できませんでした",
    });
    return 1;
  }
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  process.exitCode = runProductionWorkerDeploymentCli(process.env);
}
