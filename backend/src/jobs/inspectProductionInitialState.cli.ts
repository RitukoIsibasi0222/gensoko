import { writeFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { createPrismaClient } from "../lib/prisma-client.js";

import {
  inspectProductionInitialState,
  parseProductionInitialStateConfig,
  type ProductionInitialStateConfig,
} from "./inspectProductionInitialState.js";
import {
  determineM1Path,
  toSafeProductionInitialStateMarker,
  type ProductionInitialStateEvidence,
} from "./productionInitialStateEvidence.js";

const COMPLETED_EVENT = "production_initial_state.inspection.completed";
const FAILED_EVENT = "production_initial_state.inspection.failed";
const FAILED_MESSAGE = "production初回状態read-only確認に失敗しました";
const MARKER_FILE_NAME = "production-initial-state-evidence.json";

export type ProductionInitialStateCliDependencies = Readonly<{
  inspect: (config: ProductionInitialStateConfig) => Promise<ProductionInitialStateEvidence>;
  writeMarker: (path: string, contents: string) => Promise<void>;
  now: () => Date;
}>;

function toConfigInput(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return {
    batchEnvironment: environment.BATCH_ENVIRONMENT,
    databaseUrl: environment.DATABASE_URL,
    productionSupabaseProjectRef: environment.PRODUCTION_SUPABASE_PROJECT_REF,
    githubRepository: environment.GITHUB_REPOSITORY,
    githubToken: environment.GITHUB_TOKEN,
    vercelAccessToken: environment.M1_VERCEL_ACCESS_TOKEN,
    vercelScopeId: environment.M1_VERCEL_SCOPE_ID,
    vercelRepository: environment.M1_VERCEL_REPOSITORY,
    cloudflareApiToken: environment.M1_CLOUDFLARE_API_TOKEN,
    cloudflareAccountId: environment.M1_CLOUDFLARE_ACCOUNT_ID,
    cloudflareWorkerName: environment.M1_CLOUDFLARE_WORKER_NAME,
    reviewedSha: environment.M1_REVIEWED_SHA,
    historyAttestation: environment.M1_HISTORY_ATTESTATION,
    changeFreezeAttestation: environment.M1_CHANGE_FREEZE_ATTESTATION,
  };
}

function validateMarkerPath(markerPath: string | undefined): string {
  if (!markerPath || !isAbsolute(markerPath) || basename(markerPath) !== MARKER_FILE_NAME) {
    throw new Error(FAILED_MESSAGE);
  }
  return markerPath;
}

export async function runInspectProductionInitialStateCli(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: ProductionInitialStateCliDependencies,
  logger: Pick<Console, "info" | "error"> = console,
): Promise<number> {
  try {
    const config = parseProductionInitialStateConfig(toConfigInput(environment));
    const markerPath = validateMarkerPath(environment.M1_EVIDENCE_MARKER_PATH);
    const evidence = await dependencies.inspect(config);
    const marker = toSafeProductionInitialStateMarker(
      evidence,
      config.reviewedSha,
      dependencies.now(),
    );
    await dependencies.writeMarker(markerPath, JSON.stringify(marker) + "\n");

    logger.info({
      event: COMPLETED_EVENT,
      evidence: marker.evidence,
      decision: marker.decision,
    });
    return determineM1Path(evidence) === "path-a" ? 0 : 1;
  } catch {
    logger.error({ event: FAILED_EVENT, message: FAILED_MESSAGE });
    return 2;
  }
}

function createDefaultDependencies(): ProductionInitialStateCliDependencies {
  return {
    inspect: async (config) => {
      const prisma = createPrismaClient(config.databaseUrl);
      try {
        return await inspectProductionInitialState({ prisma, fetch: globalThis.fetch }, config);
      } finally {
        await prisma.$disconnect();
      }
    },
    writeMarker: async (markerPath, contents) => {
      await writeFile(markerPath, contents, { encoding: "utf8", flag: "wx" });
    },
    now: () => new Date(),
  };
}

async function main(): Promise<void> {
  process.exitCode = await runInspectProductionInitialStateCli(
    process.env,
    createDefaultDependencies(),
  );
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  void main();
}
