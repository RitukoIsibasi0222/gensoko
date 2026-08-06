export const PRODUCTION_RELEASE_STATUSES = [
  "VALIDATION_CLEAR",
  "BACKEND_QUALITY_CLEAR",
  "FRONTEND_QUALITY_CLEAR",
  "MIGRATION_CURRENT",
  "API_DEPLOYED",
  "API_HEALTH_CLEAR",
  "FRONTEND_DEPLOYED",
  "SMOKE_CLEAR",
] as const;

export type ProductionReleaseStatus = (typeof PRODUCTION_RELEASE_STATUSES)[number];

export type ProductionReleaseEvidence = Readonly<{
  schemaVersion: 1;
  sha: string;
  event: "push" | "workflow_dispatch";
  runId: string;
  runAttempt: number;
  statuses: readonly ProductionReleaseStatus[];
  createdAt: string;
}>;

const EVIDENCE_ERROR_MESSAGE = "production release evidenceを作成できませんでした";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;

export function toProductionReleaseEvidence(
  input: Readonly<{
    sha: string;
    event: string;
    runId: string;
    runAttempt: number;
    statuses: readonly string[];
    createdAt: Date;
  }>,
): ProductionReleaseEvidence {
  const statusesAreCanonicalPrefix =
    input.statuses.length >= 1 &&
    input.statuses.length <= PRODUCTION_RELEASE_STATUSES.length &&
    input.statuses.every((status, index) => status === PRODUCTION_RELEASE_STATUSES[index]);
  if (
    !SHA_PATTERN.test(input.sha) ||
    (input.event !== "push" && input.event !== "workflow_dispatch") ||
    !RUN_ID_PATTERN.test(input.runId) ||
    !Number.isSafeInteger(input.runAttempt) ||
    input.runAttempt < 1 ||
    !statusesAreCanonicalPrefix ||
    Number.isNaN(input.createdAt.getTime())
  ) {
    throw new Error(EVIDENCE_ERROR_MESSAGE);
  }

  return {
    schemaVersion: 1,
    sha: input.sha,
    event: input.event,
    runId: input.runId,
    runAttempt: input.runAttempt,
    statuses: input.statuses as readonly ProductionReleaseStatus[],
    createdAt: input.createdAt.toISOString(),
  };
}
