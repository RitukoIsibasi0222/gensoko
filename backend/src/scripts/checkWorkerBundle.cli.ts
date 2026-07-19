import {
  assertWorkerBundleInputs,
  WORKER_BUNDLE_DEPENDENCY_ERROR_MESSAGE,
} from "../lib/worker-bundle-contract.js";
import {
  INVALID_WORKER_BUNDLE_METADATA_MESSAGE,
  readWorkerBundleInputPaths,
} from "../lib/worker-bundle-metadata.js";

async function main(): Promise<void> {
  const metadataPath = process.argv[2];
  if (!metadataPath) {
    throw new Error(INVALID_WORKER_BUNDLE_METADATA_MESSAGE);
  }

  assertWorkerBundleInputs(await readWorkerBundleInputPaths(metadataPath));
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof Error && error.message === WORKER_BUNDLE_DEPENDENCY_ERROR_MESSAGE
      ? WORKER_BUNDLE_DEPENDENCY_ERROR_MESSAGE
      : INVALID_WORKER_BUNDLE_METADATA_MESSAGE;
  console.error(message);
  process.exitCode = 1;
}
