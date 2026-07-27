const EXPECTED_CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export type StagingEvidenceResponseHeaderContract =
  | "ACCESS_CONTROL_ALLOW_ORIGIN"
  | "ACCESS_CONTROL_ALLOW_CREDENTIALS"
  | "CONTENT_SECURITY_POLICY"
  | "CROSS_ORIGIN_RESOURCE_POLICY"
  | "PERMISSIONS_POLICY"
  | "REFERRER_POLICY"
  | "STRICT_TRANSPORT_SECURITY"
  | "X_CONTENT_TYPE_OPTIONS"
  | "X_FRAME_OPTIONS"
  | "X_PERMITTED_CROSS_DOMAIN_POLICIES"
  | "X_XSS_PROTECTION"
  | "X_POWERED_BY";

export function hasJsonContentType(response: Response): boolean {
  const contentType = response.headers.get("Content-Type");
  return contentType !== null && /^application\/json(?:\s*;|$)/i.test(contentType);
}

export async function parseJson(response: Response): Promise<unknown | null> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export async function requestStagingEvidence(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  requestTimeoutMs: number,
): Promise<Response> {
  return await fetchImpl(input, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
}

export async function cancelResponseBodyBestEffort(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // body解放の失敗で、安全な分類errorを上書きしない
  }
}

export function findFailedResponseHeaderContract(
  response: Response,
  frontendOrigin: string,
): StagingEvidenceResponseHeaderContract | null {
  const checks: ReadonlyArray<readonly [StagingEvidenceResponseHeaderContract, boolean]> = [
    [
      "ACCESS_CONTROL_ALLOW_ORIGIN",
      response.headers.get("Access-Control-Allow-Origin") === frontendOrigin,
    ],
    [
      "ACCESS_CONTROL_ALLOW_CREDENTIALS",
      response.headers.get("Access-Control-Allow-Credentials") === "true",
    ],
    [
      "CONTENT_SECURITY_POLICY",
      response.headers.get("Content-Security-Policy") === EXPECTED_CONTENT_SECURITY_POLICY,
    ],
    [
      "CROSS_ORIGIN_RESOURCE_POLICY",
      response.headers.get("Cross-Origin-Resource-Policy") === "same-origin",
    ],
    [
      "PERMISSIONS_POLICY",
      response.headers.get("Permissions-Policy") === "camera=(), microphone=(), geolocation=()",
    ],
    [
      "REFERRER_POLICY",
      response.headers.get("Referrer-Policy") === "strict-origin-when-cross-origin",
    ],
    [
      "STRICT_TRANSPORT_SECURITY",
      response.headers.get("Strict-Transport-Security") === "max-age=31536000; includeSubDomains",
    ],
    ["X_CONTENT_TYPE_OPTIONS", response.headers.get("X-Content-Type-Options") === "nosniff"],
    ["X_FRAME_OPTIONS", response.headers.get("X-Frame-Options") === "DENY"],
    [
      "X_PERMITTED_CROSS_DOMAIN_POLICIES",
      response.headers.get("X-Permitted-Cross-Domain-Policies") === "none",
    ],
    ["X_XSS_PROTECTION", response.headers.get("X-XSS-Protection") === "0"],
    ["X_POWERED_BY", response.headers.get("X-Powered-By") === null],
  ];
  return checks.find(([, passed]) => !passed)?.[0] ?? null;
}
