import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export const WRANGLER_LOCAL_BUILD_ERROR_MESSAGE = "Wrangler local buildに失敗しました";

export type WranglerDryRunOptions = Readonly<{
  configPath: string;
  environment?: string;
  outputDirectory: string;
}>;

const resolveFromModule = createRequire(import.meta.url);
const wranglerCliPath = join(
  dirname(resolveFromModule.resolve("wrangler/package.json")),
  "bin",
  "wrangler.js",
);

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

  const result = spawnSync(process.execPath, [wranglerCliPath, ...argumentsList], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0 || result.error) {
    throw new Error(WRANGLER_LOCAL_BUILD_ERROR_MESSAGE);
  }
}
