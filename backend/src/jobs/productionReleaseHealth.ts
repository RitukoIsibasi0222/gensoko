import {
  findFailedResponseHeaderContract,
  hasJsonContentType,
  parseJson,
  requestStagingEvidence,
} from "./stagingEvidenceHttp.js";

const REQUEST_TIMEOUT_MS = 10_000;
const HEALTH_ERROR_MESSAGE = "production API health確認に失敗しました";

export class ProductionReleaseHealthError extends Error {
  constructor() {
    super(HEALTH_ERROR_MESSAGE);
    this.name = "ProductionReleaseHealthError";
  }
}

function failHealth(): never {
  throw new ProductionReleaseHealthError();
}

function isProviderHostname(hostname: string): boolean {
  return ["workers.dev", "vercel.app"].some(
    (provider) => hostname === provider || hostname.endsWith(`.${provider}`),
  );
}

function parseProductionUrls(apiBaseUrl: string, frontendOrigin: string): void {
  let api: URL;
  let frontend: URL;
  try {
    api = new URL(apiBaseUrl);
    frontend = new URL(frontendOrigin);
  } catch {
    failHealth();
  }
  if (
    api.protocol !== "https:" ||
    api.username ||
    api.password ||
    api.port ||
    api.pathname !== "/api/v1" ||
    api.search ||
    api.hash ||
    apiBaseUrl !== api.href.replace(/\/$/, "") ||
    frontend.protocol !== "https:" ||
    frontend.username ||
    frontend.password ||
    frontend.port ||
    frontend.pathname !== "/" ||
    frontend.search ||
    frontend.hash ||
    frontendOrigin !== frontend.origin ||
    api.hostname === frontend.hostname ||
    isProviderHostname(api.hostname) ||
    isProviderHostname(frontend.hostname)
  ) {
    failHealth();
  }
}

function hasExpectedHealthBody(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    record.status !== "ok" ||
    typeof record.timestamp !== "string"
  ) {
    return false;
  }
  const timestamp = new Date(record.timestamp);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === record.timestamp;
}

export async function validateProductionReleaseHealth({
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
  parseProductionUrls(apiBaseUrl, frontendOrigin);
  if (requestTimeoutMs !== REQUEST_TIMEOUT_MS) failHealth();

  let response: Response;
  try {
    response = await requestStagingEvidence(
      fetchImpl,
      `${apiBaseUrl}/health`,
      { method: "GET", headers: { Origin: frontendOrigin } },
      requestTimeoutMs,
    );
  } catch {
    failHealth();
  }
  if (
    response.status !== 200 ||
    findFailedResponseHeaderContract(response, frontendOrigin) !== null ||
    !hasJsonContentType(response) ||
    !hasExpectedHealthBody(await parseJson(response))
  ) {
    failHealth();
  }
  return { status: "clear" };
}
