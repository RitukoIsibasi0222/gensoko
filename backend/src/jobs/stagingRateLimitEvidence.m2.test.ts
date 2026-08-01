import { describe, expect, it, vi } from "vitest";

import { runStagingRateLimitEvidence } from "./stagingRateLimitEvidence.js";

const API_BASE_URL = "https://gensoko-api-staging.rituko-labs.workers.dev/api/v1";
const FRONTEND_ORIGIN = "https://gensoko-frontend-staging-develop.vercel.app";
const M2_EMAIL = "m2-release-candidate-user@example.test";
const SAFE_HEADERS = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
  "Content-Security-Policy":
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "0",
} as const;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...SAFE_HEADERS, ...headers },
  });
}

describe("staging rate limit evidence M2 reuse", () => {
  it("auth identityを注入して既存10+1 contractを重複なしで実行する", async () => {
    let requestNumber = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      requestNumber += 1;
      return requestNumber <= 10
        ? jsonResponse(200, {
            accessToken: "secret-token",
            user: { id: "secret-id", username: "m2", role: "USER" },
          })
        : jsonResponse(
            429,
            { error: "リクエストが多すぎます。しばらく待ってから再試行してください" },
            { "Retry-After": "42" },
          );
    });

    await runStagingRateLimitEvidence({
      apiBaseUrl: API_BASE_URL,
      frontendOrigin: FRONTEND_ORIGIN,
      evidenceCase: "auth",
      userEmail: M2_EMAIL,
      userPassword: "M2Synthetic1!password",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(11);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ email: M2_EMAIL });
    }
  });
});
