import { readFile } from "node:fs/promises";
import { z } from "zod";

export const INVALID_WORKER_BUNDLE_METADATA_MESSAGE = "Workers bundleの検証情報が不正です";

const workerBundleMetadataSchema = z.object({
  inputs: z.record(z.string(), z.unknown()),
});

const WORKER_ENTRYPOINTS = ["worker.ts", "worker-production.ts"] as const;

function isWorkerEntrypoint(inputPath: string): boolean {
  const normalizedPath = inputPath.replaceAll("\\", "/");
  return WORKER_ENTRYPOINTS.some(
    (entrypoint) =>
      normalizedPath === `src/${entrypoint}` || normalizedPath.endsWith(`/src/${entrypoint}`),
  );
}

export function parseWorkerBundleInputPaths(metadata: unknown): readonly string[] {
  const parsedMetadata = workerBundleMetadataSchema.safeParse(metadata);
  if (!parsedMetadata.success || Array.isArray(parsedMetadata.data.inputs)) {
    throw new Error(INVALID_WORKER_BUNDLE_METADATA_MESSAGE);
  }

  const inputPaths = Object.keys(parsedMetadata.data.inputs);
  if (inputPaths.length === 0 || !inputPaths.some(isWorkerEntrypoint)) {
    throw new Error(INVALID_WORKER_BUNDLE_METADATA_MESSAGE);
  }

  return inputPaths;
}

export async function readWorkerBundleInputPaths(metadataPath: string): Promise<readonly string[]> {
  try {
    const metadata: unknown = JSON.parse(await readFile(metadataPath, "utf8"));
    return parseWorkerBundleInputPaths(metadata);
  } catch {
    throw new Error(INVALID_WORKER_BUNDLE_METADATA_MESSAGE);
  }
}
