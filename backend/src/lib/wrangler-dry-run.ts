import { spawnSync } from "node:child_process";

export const WRANGLER_LOCAL_BUILD_ERROR_MESSAGE = "Wrangler local buildに失敗しました";

export type WranglerDryRunOptions = Readonly<{
  configPath: string;
  environment?: string;
  outputDirectory: string;
}>;

/**
 * binding値を標準出力へ出さずにWranglerのlocal bundleを生成する。
 */
export function runWranglerDryRun({
  configPath,
  environment,
  outputDirectory,
}: WranglerDryRunOptions): void {
  const argumentsList = [
    "deploy",
    "--dry-run",
    "--config",
    configPath,
    "--outdir",
    outputDirectory,
    "--metafile",
  ];
  if (environment) {
    argumentsList.push("--env", environment);
  }

  const result = spawnSync("./node_modules/.bin/wrangler", argumentsList, {
    encoding: "utf8",
    env: {
      ...process.env,
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0 || result.error) {
    throw new Error(WRANGLER_LOCAL_BUILD_ERROR_MESSAGE);
  }
}
