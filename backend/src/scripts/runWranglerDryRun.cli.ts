import { runWranglerDryRun, WRANGLER_LOCAL_BUILD_ERROR_MESSAGE } from "../lib/wrangler-dry-run.js";

const INVALID_ARGUMENTS_MESSAGE = "Wrangler local buildの引数が不正です";

try {
  const configPath = process.argv[2];
  const environment = process.argv[3];
  const outputDirectory = process.argv[4];
  if (!configPath || !environment || !outputDirectory) {
    throw new Error(INVALID_ARGUMENTS_MESSAGE);
  }

  runWranglerDryRun({ configPath, environment, outputDirectory });
} catch (error) {
  const message =
    error instanceof Error && error.message === WRANGLER_LOCAL_BUILD_ERROR_MESSAGE
      ? WRANGLER_LOCAL_BUILD_ERROR_MESSAGE
      : INVALID_ARGUMENTS_MESSAGE;
  console.error(message);
  process.exitCode = 1;
}
