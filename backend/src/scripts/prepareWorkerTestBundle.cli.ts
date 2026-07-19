import { readFile, writeFile } from "node:fs/promises";
import { assertWorkerBundleInputs } from "../lib/worker-bundle-contract.js";
import { runWranglerDryRun, WRANGLER_LOCAL_BUILD_ERROR_MESSAGE } from "../lib/wrangler-dry-run.js";

const TEST_CONFIG_PATH = "wrangler.test.jsonc";
const TEST_BUILD_DIRECTORY = ".wrangler/test-build";
const TEST_BUILD_CONFIG_PATH = `${TEST_BUILD_DIRECTORY}/wrangler.jsonc`;
const TEST_BUILD_METADATA_PATH = `${TEST_BUILD_DIRECTORY}/bundle-meta.json`;
const WORKER_TEST_PREPARATION_ERROR_MESSAGE = "Workers test bundleの準備に失敗しました";
const WORKER_TEST_SOURCE_CONFIG_ERROR_MESSAGE = "Workers test元設定の読み込みに失敗しました";
const WORKER_TEST_METADATA_ERROR_MESSAGE = "Workers test bundle情報の検証に失敗しました";
const WORKER_TEST_CONFIG_WRITE_ERROR_MESSAGE = "Workers test生成設定の保存に失敗しました";

type BundleMetadata = Readonly<{ inputs?: Record<string, unknown> }>;

async function main(): Promise<void> {
  let sourceConfig: string;
  try {
    sourceConfig = await readFile(TEST_CONFIG_PATH, "utf8");
  } catch {
    throw new Error(WORKER_TEST_SOURCE_CONFIG_ERROR_MESSAGE);
  }
  const generatedConfig = sourceConfig.replace(/("main"\s*:\s*)"src\/worker\.ts"/, '$1"worker.js"');
  if (generatedConfig === sourceConfig) {
    throw new Error(WORKER_TEST_SOURCE_CONFIG_ERROR_MESSAGE);
  }
  runWranglerDryRun({
    configPath: TEST_CONFIG_PATH,
    outputDirectory: TEST_BUILD_DIRECTORY,
  });

  let metadata: BundleMetadata;
  try {
    metadata = JSON.parse(await readFile(TEST_BUILD_METADATA_PATH, "utf8")) as BundleMetadata;
  } catch {
    throw new Error(WORKER_TEST_METADATA_ERROR_MESSAGE);
  }
  if (!metadata.inputs || typeof metadata.inputs !== "object") {
    throw new Error(WORKER_TEST_METADATA_ERROR_MESSAGE);
  }
  assertWorkerBundleInputs(Object.keys(metadata.inputs));

  try {
    await writeFile(TEST_BUILD_CONFIG_PATH, generatedConfig, "utf8");
  } catch {
    throw new Error(WORKER_TEST_CONFIG_WRITE_ERROR_MESSAGE);
  }
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof Error && error.message === WRANGLER_LOCAL_BUILD_ERROR_MESSAGE
      ? WRANGLER_LOCAL_BUILD_ERROR_MESSAGE
      : error instanceof Error &&
          [
            WORKER_TEST_SOURCE_CONFIG_ERROR_MESSAGE,
            WORKER_TEST_METADATA_ERROR_MESSAGE,
            WORKER_TEST_CONFIG_WRITE_ERROR_MESSAGE,
          ].includes(error.message)
        ? error.message
        : WORKER_TEST_PREPARATION_ERROR_MESSAGE;
  console.error(message);
  process.exitCode = 1;
}
