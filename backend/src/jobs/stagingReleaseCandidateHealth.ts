import {
  findFailedResponseHeaderContract,
  hasJsonContentType,
  parseJson,
  requestStagingEvidence,
} from "./stagingEvidenceHttp.js";
import type { M2EvidenceStatus } from "./stagingReleaseCandidateEvidence.js";

export const M2_STAGING_API_BASE_URL = "https://gensoko-api-staging.rituko-labs.workers.dev/api/v1";
export const M2_STAGING_FRONTEND_ORIGIN = "https://gensoko-frontend-staging-develop.vercel.app";
const REQUEST_TIMEOUT_MS = 10_000;
const HEALTH_CHECK_ERROR_MESSAGE = "M2 staging API health確認に失敗しました";

export class M2StagingHealthCheckError extends Error {
  readonly status: Exclude<M2EvidenceStatus, "clear">;

  constructor(status: Exclude<M2EvidenceStatus, "clear">) {
    super(HEALTH_CHECK_ERROR_MESSAGE);
    this.name = "M2StagingHealthCheckError";
    this.status = status;
  }
}

function hasExpectedHealthBody(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    record.status !== "ok" ||
    typeof record.timestamp !== "string"
  ) {
    return false;
  }
  const parsedTimestamp = new Date(record.timestamp);
  return (
    !Number.isNaN(parsedTimestamp.getTime()) && parsedTimestamp.toISOString() === record.timestamp
  );
}

export async function validateM2StagingHealth({
  apiBaseUrl,
  frontendOrigin,
  fetchImpl = fetch,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
}: Readonly<{
  apiBaseUrl: string;
  frontendOrigin: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}>): Promise<Readonly<{ status: "clear" }>> {
  if (
    apiBaseUrl !== M2_STAGING_API_BASE_URL ||
    frontendOrigin !== M2_STAGING_FRONTEND_ORIGIN ||
    requestTimeoutMs !== REQUEST_TIMEOUT_MS
  ) {
    throw new M2StagingHealthCheckError("unknown");
  }

  let response: Response;
  try {
    response = await requestStagingEvidence(
      fetchImpl,
      `${apiBaseUrl}/health`,
      { method: "GET", headers: { Origin: frontendOrigin } },
      requestTimeoutMs,
    );
  } catch {
    throw new M2StagingHealthCheckError("unknown");
  }

  if (findFailedResponseHeaderContract(response, frontendOrigin) !== null) {
    throw new M2StagingHealthCheckError("present");
  }
  if (response.status !== 200) {
    throw new M2StagingHealthCheckError("present");
  }
  if (!hasJsonContentType(response)) {
    throw new M2StagingHealthCheckError("unknown");
  }
  const body = await parseJson(response);
  if (!hasExpectedHealthBody(body)) {
    throw new M2StagingHealthCheckError("unknown");
  }
  return { status: "clear" };
}
