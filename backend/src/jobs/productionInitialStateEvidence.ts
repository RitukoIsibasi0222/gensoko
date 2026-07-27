const SAFE_MARKER_ERROR_MESSAGE = "安全なM1証拠markerを作成できませんでした";
const REVIEWED_SHA_PATTERN = /^[0-9a-f]{40}$/;
const M1_CHECK_STATUSES = new Set(["clear", "present", "unknown"]);

export type M1CheckStatus = "clear" | "present" | "unknown";

export const M1_EVIDENCE_CHECK_KEYS = [
  "databaseTarget",
  "allUsers",
  "legacyUsers",
  "userRelatedRows",
  "auditLogs",
  "vercelProductionDeployments",
  "cloudflareProductionDeployments",
  "githubProductionDeployments",
  "productionBackupHistory",
  "deletedHistoryAndExternalCopyAttestation",
  "productionChangeFreezeAttestation",
] as const;

export type M1EvidenceCheckKey = (typeof M1_EVIDENCE_CHECK_KEYS)[number];

export type ProductionInitialStateEvidence = Readonly<
  { schemaVersion: 1 } & Record<M1EvidenceCheckKey, M1CheckStatus>
>;

export type M1Path = "path-a" | "path-b";

export type SafeProductionInitialStateMarker = Readonly<{
  schemaVersion: 1;
  reviewedSha: string;
  executedAt: string;
  evidence: ProductionInitialStateEvidence;
  decision: M1Path;
}>;

export function createUnknownProductionInitialStateEvidence(): ProductionInitialStateEvidence {
  return {
    schemaVersion: 1,
    databaseTarget: "unknown",
    allUsers: "unknown",
    legacyUsers: "unknown",
    userRelatedRows: "unknown",
    auditLogs: "unknown",
    vercelProductionDeployments: "unknown",
    cloudflareProductionDeployments: "unknown",
    githubProductionDeployments: "unknown",
    productionBackupHistory: "unknown",
    deletedHistoryAndExternalCopyAttestation: "unknown",
    productionChangeFreezeAttestation: "unknown",
  };
}

export function determineM1Path(evidence: ProductionInitialStateEvidence): M1Path {
  return M1_EVIDENCE_CHECK_KEYS.every((key) => evidence[key] === "clear") ? "path-a" : "path-b";
}

function toAllowlistedEvidence(
  evidence: ProductionInitialStateEvidence,
): ProductionInitialStateEvidence {
  if (
    evidence.schemaVersion !== 1 ||
    M1_EVIDENCE_CHECK_KEYS.some((key) => !M1_CHECK_STATUSES.has(evidence[key]))
  ) {
    throw new Error(SAFE_MARKER_ERROR_MESSAGE);
  }

  return {
    schemaVersion: 1,
    databaseTarget: evidence.databaseTarget,
    allUsers: evidence.allUsers,
    legacyUsers: evidence.legacyUsers,
    userRelatedRows: evidence.userRelatedRows,
    auditLogs: evidence.auditLogs,
    vercelProductionDeployments: evidence.vercelProductionDeployments,
    cloudflareProductionDeployments: evidence.cloudflareProductionDeployments,
    githubProductionDeployments: evidence.githubProductionDeployments,
    productionBackupHistory: evidence.productionBackupHistory,
    deletedHistoryAndExternalCopyAttestation: evidence.deletedHistoryAndExternalCopyAttestation,
    productionChangeFreezeAttestation: evidence.productionChangeFreezeAttestation,
  };
}

export function toSafeProductionInitialStateMarker(
  evidence: ProductionInitialStateEvidence,
  reviewedSha: string,
  executedAt: Date,
): SafeProductionInitialStateMarker {
  if (!REVIEWED_SHA_PATTERN.test(reviewedSha) || Number.isNaN(executedAt.getTime())) {
    throw new Error(SAFE_MARKER_ERROR_MESSAGE);
  }

  const allowlistedEvidence = toAllowlistedEvidence(evidence);
  return {
    schemaVersion: 1,
    reviewedSha,
    executedAt: executedAt.toISOString(),
    evidence: allowlistedEvidence,
    decision: determineM1Path(allowlistedEvidence),
  };
}
