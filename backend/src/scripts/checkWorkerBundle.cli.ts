import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  assertWorkerBundleInputs,
  WORKER_BUNDLE_DEPENDENCY_ERROR_MESSAGE,
} from "../lib/worker-bundle-contract.js";

const INVALID_WORKER_BUNDLE_METADATA_MESSAGE = "Workers bundleの検証情報が不正です";

const bundleMetadataSchema = z.object({
  inputs: z.record(z.string(), z.unknown()),
});

async function main(): Promise<void> {
  const metadataPath = process.argv[2];
  if (!metadataPath) {
    throw new Error(INVALID_WORKER_BUNDLE_METADATA_MESSAGE);
  }

  const metadata: unknown = JSON.parse(await readFile(metadataPath, "utf8"));
  const parsedMetadata = bundleMetadataSchema.safeParse(metadata);
  if (!parsedMetadata.success) {
    throw new Error(INVALID_WORKER_BUNDLE_METADATA_MESSAGE);
  }

  assertWorkerBundleInputs(Object.keys(parsedMetadata.data.inputs));
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
