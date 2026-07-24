import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfigFileTextToJson } from "typescript";
import {
  buildStagingRollbackBaselineConfig,
  STAGING_ROLLBACK_WORKER_CONFIG_ERROR_MESSAGE,
} from "../lib/staging-rollback-worker-config.js";
import { runWranglerDryRun } from "../lib/wrangler-dry-run.js";

const STAGING_ROLLBACK_BASELINE_DRY_RUN_ERROR_MESSAGE = "rollback baseline dry-runに失敗しました";

function readCheckedInStagingConfig(): unknown {
  const configPath = "wrangler.jsonc";
  const { config, error } = parseConfigFileTextToJson(configPath, readFileSync(configPath, "utf8"));
  if (error) {
    throw new Error(STAGING_ROLLBACK_WORKER_CONFIG_ERROR_MESSAGE);
  }
  return config;
}

const outputDirectory = process.argv[2];
if (!outputDirectory) {
  console.error(STAGING_ROLLBACK_BASELINE_DRY_RUN_ERROR_MESSAGE);
  process.exitCode = 1;
} else {
  const configPath = join(
    process.cwd(),
    `.wrangler.staging-rollback-baseline.generated.${process.pid}.json`,
  );
  let failed = false;
  try {
    const config = buildStagingRollbackBaselineConfig(readCheckedInStagingConfig());
    writeFileSync(configPath, JSON.stringify(config), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    runWranglerDryRun({ configPath, outputDirectory });
  } catch {
    failed = true;
  } finally {
    try {
      rmSync(configPath, { force: true });
    } catch {
      failed = true;
    }
  }

  if (failed) {
    console.error(STAGING_ROLLBACK_BASELINE_DRY_RUN_ERROR_MESSAGE);
    process.exitCode = 1;
  }
}
