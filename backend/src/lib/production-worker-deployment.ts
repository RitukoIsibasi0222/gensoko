import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseConfigFileTextToJson } from "typescript";

import { buildProductionWorkerConfigFromEnvironment } from "./production-worker-config.js";

export const PRODUCTION_WORKER_DEPLOYMENT_ERROR_MESSAGE =
  "production Worker deployを安全に完了できませんでした";

type CommandResult = Readonly<{
  status: number | null;
  stdout: string;
  stderr: string;
}>;

type CommandRunner = (
  command: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; env: NodeJS.ProcessEnv }>,
) => CommandResult;

function defaultRunner(
  command: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; env: NodeJS.ProcessEnv }>,
): CommandResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 300_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function failDeployment(): never {
  throw new Error(PRODUCTION_WORKER_DEPLOYMENT_ERROR_MESSAGE);
}

function readStagingHyperdriveId(configPath: string): string {
  const { config, error } = parseConfigFileTextToJson(configPath, readFileSync(configPath, "utf8"));
  const value = (config as { env?: { staging?: { hyperdrive?: Array<{ id?: unknown }> } } }).env
    ?.staging?.hyperdrive?.[0]?.id;
  if (error || typeof value !== "string") failDeployment();
  return value;
}

function containsExactMarker(value: unknown, marker: string): boolean {
  if (value === marker) return true;
  if (Array.isArray(value)) return value.some((entry) => containsExactMarker(entry, marker));
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((entry) => containsExactMarker(entry, marker));
  }
  return false;
}

export function runProductionWorkerDeployment({
  expectedSha,
  environment,
  stagingConfigPath,
  workingDirectory,
  runner = defaultRunner,
}: Readonly<{
  expectedSha: string;
  environment: Readonly<Record<string, string | undefined>>;
  stagingConfigPath: string;
  workingDirectory: string;
  runner?: CommandRunner;
}>): Readonly<{ status: "deployed" }> {
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) failDeployment();
  const runnerTemp = environment.RUNNER_TEMP;
  if (!runnerTemp) failDeployment();

  const configPath = join(runnerTemp, `wrangler.production.${process.pid}.json`);
  const providerLogPath = join(runnerTemp, "production-worker-provider.log");
  const statePath = join(runnerTemp, "production-worker-state.json");
  const releaseMarker = `production-release:${expectedSha}`;
  const processEnvironment = { ...process.env, ...environment };

  try {
    const config = buildProductionWorkerConfigFromEnvironment(
      processEnvironment,
      readStagingHyperdriveId(resolve(workingDirectory, stagingConfigPath)),
    );
    writeFileSync(configPath, JSON.stringify(config), { encoding: "utf8", mode: 0o600 });

    const deploy = runner(
      "npx",
      ["wrangler", "deploy", "--config", configPath, "--message", releaseMarker],
      { cwd: workingDirectory, env: processEnvironment },
    );
    writeFileSync(providerLogPath, `${deploy.stdout}${deploy.stderr}`, {
      encoding: "utf8",
      mode: 0o600,
    });
    if (deploy.status !== 0) failDeployment();

    const status = runner(
      "npx",
      ["wrangler", "deployments", "status", "--config", configPath, "--json"],
      { cwd: workingDirectory, env: processEnvironment },
    );
    writeFileSync(statePath, status.stdout, { encoding: "utf8", mode: 0o600 });
    writeFileSync(providerLogPath, status.stderr, { encoding: "utf8", mode: 0o600 });
    if (status.status !== 0) failDeployment();

    let state: unknown;
    try {
      state = JSON.parse(status.stdout) as unknown;
    } catch {
      failDeployment();
    }
    if (!containsExactMarker(state, releaseMarker)) failDeployment();
    return { status: "deployed" };
  } catch {
    failDeployment();
  } finally {
    rmSync(configPath, { force: true });
    rmSync(providerLogPath, { force: true });
    rmSync(statePath, { force: true });
  }
}
