import { z } from "zod";

const SAFE_EVIDENCE_ERROR_MESSAGE = "安全なM2証拠を作成できませんでした";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type M2EvidenceStatus = "clear" | "present" | "unknown";
export type M2CleanupStatus = M2EvidenceStatus | "not-required";

const evidenceStatusSchema = z.enum(["clear", "present", "unknown"]);
const cleanupStatusSchema = z.enum(["clear", "present", "unknown", "not-required"]);

const deploymentSchema = z
  .object({
    databaseTarget: evidenceStatusSchema,
    apiCandidate: evidenceStatusSchema,
    frontendCandidate: evidenceStatusSchema,
    passwordVerifierBinding: evidenceStatusSchema,
  })
  .strict();

const campaignSchema = z
  .object({
    registration: evidenceStatusSchema,
    emailVerification: evidenceStatusSchema,
    validLogin: evidenceStatusSchema,
    refreshProtocol: evidenceStatusSchema,
    mainWorkerCpu: evidenceStatusSchema,
    authAllowedTen: evidenceStatusSchema,
    authEleventh429: evidenceStatusSchema,
    authRetryAfter: evidenceStatusSchema,
    authReset: evidenceStatusSchema,
    game: evidenceStatusSchema,
    keyboard: evidenceStatusSchema,
    viewport320: evidenceStatusSchema,
    selfDeletion: evidenceStatusSchema,
    oldCredentialRejection: evidenceStatusSchema,
    headersCorsSafeErrors: evidenceStatusSchema,
  })
  .strict();

const cleanupSchema = z
  .object({
    main: evidenceStatusSchema,
    recovery: cleanupStatusSchema,
    residue: evidenceStatusSchema,
  })
  .strict();

const m2EvidenceInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    workflowName: z.literal("staging-release-candidate-campaign"),
    evidenceVersion: z.literal("m2-v1"),
    releaseCandidateSha: z.string().regex(SHA_PATTERN),
    startedAt: z.string().regex(ISO_TIMESTAMP_PATTERN),
    completedAt: z.string().regex(ISO_TIMESTAMP_PATTERN),
    m1Gate: evidenceStatusSchema,
    deployment: deploymentSchema,
    campaign: campaignSchema,
    cleanup: cleanupSchema,
    authAllowedRequests: z.literal(10),
    authLimitedRequest: z.literal(11),
    decision: evidenceStatusSchema,
  })
  .strict();

export type M2StagingReleaseCandidateEvidence = z.infer<typeof m2EvidenceInputSchema>;

function determineStatus(statuses: readonly M2EvidenceStatus[]): M2EvidenceStatus {
  if (statuses.includes("present")) {
    return "present";
  }
  return statuses.includes("unknown") ? "unknown" : "clear";
}

export function determineM2Decision(
  evidence: Omit<M2StagingReleaseCandidateEvidence, "decision">,
): M2EvidenceStatus {
  const cleanupStatuses: M2EvidenceStatus[] = [evidence.cleanup.main, evidence.cleanup.residue];
  if (evidence.cleanup.recovery !== "not-required") {
    cleanupStatuses.push(evidence.cleanup.recovery);
  }
  return determineStatus([
    evidence.m1Gate,
    ...Object.values(evidence.deployment),
    ...Object.values(evidence.campaign),
    ...cleanupStatuses,
  ]);
}

export function createM2Evidence(input: unknown): M2StagingReleaseCandidateEvidence {
  const parsed = m2EvidenceInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(SAFE_EVIDENCE_ERROR_MESSAGE);
  }
  const allowlisted = { ...parsed.data };
  delete (allowlisted as { decision?: M2EvidenceStatus }).decision;
  return { ...allowlisted, decision: determineM2Decision(allowlisted) };
}

export function createUnknownM2Evidence({
  releaseCandidateSha,
  startedAt,
  completedAt,
}: {
  releaseCandidateSha: string;
  startedAt: Date;
  completedAt: Date;
}): M2StagingReleaseCandidateEvidence {
  const unknown = "unknown" as const;
  return createM2Evidence({
    schemaVersion: 1,
    workflowName: "staging-release-candidate-campaign",
    evidenceVersion: "m2-v1",
    releaseCandidateSha,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    m1Gate: unknown,
    deployment: {
      databaseTarget: unknown,
      apiCandidate: unknown,
      frontendCandidate: unknown,
      passwordVerifierBinding: unknown,
    },
    campaign: {
      registration: unknown,
      emailVerification: unknown,
      validLogin: unknown,
      refreshProtocol: unknown,
      mainWorkerCpu: unknown,
      authAllowedTen: unknown,
      authEleventh429: unknown,
      authRetryAfter: unknown,
      authReset: unknown,
      game: unknown,
      keyboard: unknown,
      viewport320: unknown,
      selfDeletion: unknown,
      oldCredentialRejection: unknown,
      headersCorsSafeErrors: unknown,
    },
    cleanup: { main: unknown, recovery: unknown, residue: unknown },
    authAllowedRequests: 10,
    authLimitedRequest: 11,
    decision: unknown,
  });
}

const m1EvidenceStatusSchema = z.enum(["clear", "present", "unknown"]);
const m1MarkerSchema = z
  .object({
    schemaVersion: z.literal(1),
    reviewedSha: z.string().regex(SHA_PATTERN),
    executedAt: z.string().regex(ISO_TIMESTAMP_PATTERN),
    evidence: z
      .object({
        schemaVersion: z.literal(1),
        databaseTarget: m1EvidenceStatusSchema,
        allUsers: m1EvidenceStatusSchema,
        legacyUsers: m1EvidenceStatusSchema,
        userRelatedRows: m1EvidenceStatusSchema,
        auditLogs: m1EvidenceStatusSchema,
        vercelProductionDeployments: m1EvidenceStatusSchema,
        cloudflareProductionDeployments: m1EvidenceStatusSchema,
        githubProductionDeployments: m1EvidenceStatusSchema,
        productionBackupHistory: m1EvidenceStatusSchema,
        deletedHistoryAndExternalCopyAttestation: m1EvidenceStatusSchema,
        productionChangeFreezeAttestation: m1EvidenceStatusSchema,
      })
      .strict(),
    decision: z.enum(["path-a", "path-b"]),
  })
  .strict();

export function validateM1PathAEvidence(
  input: unknown,
  releaseCandidateSha: string,
): Readonly<{ status: M2EvidenceStatus }> {
  const parsed = m1MarkerSchema.safeParse(input);
  if (!parsed.success || parsed.data.reviewedSha !== releaseCandidateSha) {
    return { status: "unknown" };
  }
  const statuses = Object.entries(parsed.data.evidence)
    .filter(([key]) => key !== "schemaVersion")
    .map(([, status]) => status);
  return {
    status:
      parsed.data.decision === "path-a" && statuses.every((status) => status === "clear")
        ? "clear"
        : "present",
  };
}
