import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseConfigFileTextToJson } from "typescript";
import {
  buildProductionWorkerConfigFromEnvironment,
  PRODUCTION_WORKER_CONFIG_ERROR_MESSAGE,
} from "../lib/production-worker-config.js";
import { runWranglerDryRun } from "../lib/wrangler-dry-run.js";

function readStagingHyperdriveId(): string {
  const configPath = "wrangler.jsonc";
  const { config, error } = parseConfigFileTextToJson(configPath, readFileSync(configPath, "utf8"));
  const value = (
    config as {
      env?: { staging?: { hyperdrive?: Array<{ id?: unknown }> } };
    }
  ).env?.staging?.hyperdrive?.[0]?.id;
  if (error || typeof value !== "string") {
    throw new Error(PRODUCTION_WORKER_CONFIG_ERROR_MESSAGE);
  }
  return value;
}

const outputDirectory = process.argv[2];
if (!outputDirectory) {
  console.error(PRODUCTION_WORKER_CONFIG_ERROR_MESSAGE);
  process.exitCode = 1;
} else {
  const configPath = join(outputDirectory, "wrangler.production.generated.json");
  try {
    const config = buildProductionWorkerConfigFromEnvironment(
      process.env,
      readStagingHyperdriveId(),
    );
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config), { encoding: "utf8", mode: 0o600 });
    runWranglerDryRun({ configPath, outputDirectory });
  } catch {
    console.error(PRODUCTION_WORKER_CONFIG_ERROR_MESSAGE);
    process.exitCode = 1;
  } finally {
    rmSync(configPath, { force: true });
  }
}
