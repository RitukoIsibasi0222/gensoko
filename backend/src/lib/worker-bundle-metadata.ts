import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  WORKER_BUNDLE_ENTRYPOINT_BY_PROFILE,
  type WorkerBundleProfile,
} from "./worker-bundle-profile.js";

export const INVALID_WORKER_BUNDLE_METADATA_MESSAGE = "Workers bundleの検証情報が不正です";

const workerBundleMetadataSchema = z.object({
  inputs: z.record(z.string(), z.unknown()),
});

const WORKER_ENTRYPOINTS = Object.values(WORKER_BUNDLE_ENTRYPOINT_BY_PROFILE);

function getWorkerEntrypoint(inputPath: string): string | undefined {
  const normalizedPath = inputPath.replaceAll("\\", "/");
  return WORKER_ENTRYPOINTS.find(
    (entrypoint) =>
      normalizedPath === `src/${entrypoint}` || normalizedPath.endsWith(`/src/${entrypoint}`),
  );
}

export function parseWorkerBundleInputPaths(
  metadata: unknown,
  profile: WorkerBundleProfile = "standard",
): readonly string[] {
  const parsedMetadata = workerBundleMetadataSchema.safeParse(metadata);
  if (!parsedMetadata.success || Array.isArray(parsedMetadata.data.inputs)) {
    throw new Error(INVALID_WORKER_BUNDLE_METADATA_MESSAGE);
  }

  const inputPaths = Object.keys(parsedMetadata.data.inputs);
  const entrypoints = inputPaths.map(getWorkerEntrypoint).filter((value) => value !== undefined);
  if (
    inputPaths.length === 0 ||
    entrypoints.length !== 1 ||
    entrypoints[0] !== WORKER_BUNDLE_ENTRYPOINT_BY_PROFILE[profile]
  ) {
    throw new Error(INVALID_WORKER_BUNDLE_METADATA_MESSAGE);
  }

  return inputPaths;
}

export async function readWorkerBundleInputPaths(
  metadataPath: string,
  profile: WorkerBundleProfile = "standard",
): Promise<readonly string[]> {
  try {
    const metadata: unknown = JSON.parse(await readFile(metadataPath, "utf8"));
    return parseWorkerBundleInputPaths(metadata, profile);
  } catch {
    throw new Error(INVALID_WORKER_BUNDLE_METADATA_MESSAGE);
  }
}
