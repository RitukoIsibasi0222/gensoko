import { describe, expect, it, vi } from "vitest";

import {
  M2_STAGING_API_BASE_URL,
  M2_STAGING_FRONTEND_ORIGIN,
  M2StagingHealthCheckError,
  validateM2StagingHealth,
} from "./stagingReleaseCandidateHealth.js";

const CSP = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const SAFE_HEADERS = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": M2_STAGING_FRONTEND_ORIGIN,
  "Content-Security-Policy": CSP,
  "Content-Type": "application/json",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "0",
} as const;

function healthResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...SAFE_HEADERS, ...headers },
  });
}

describe("M2 staging API health gate", () => {
  it("固定staging URLのhealth・CORS・security headersをclearへ縮約する", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(healthResponse({ status: "ok", timestamp: "2026-07-28T00:00:00.000Z" }));

    await expect(
      validateM2StagingHealth({
        apiBaseUrl: M2_STAGING_API_BASE_URL,
        frontendOrigin: M2_STAGING_FRONTEND_ORIGIN,
        fetchImpl,
      }),
    ).resolves.toEqual({ status: "clear" });

    expect(fetchImpl).toHaveBeenCalledWith(
      `${M2_STAGING_API_BASE_URL}/health`,
      expect.objectContaining({
        method: "GET",
        headers: { Origin: M2_STAGING_FRONTEND_ORIGIN },
        redirect: "error",
      }),
    );
  });

  it("CORSまたはsecurity header不一致はpresentへ倒す", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        healthResponse(
          { status: "ok", timestamp: "2026-07-28T00:00:00.000Z" },
          { "Access-Control-Allow-Origin": "https://attacker.example" },
        ),
      );

    await expect(
      validateM2StagingHealth({
        apiBaseUrl: M2_STAGING_API_BASE_URL,
        frontendOrigin: M2_STAGING_FRONTEND_ORIGIN,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ status: "present" });
  });

  it("network・non-JSON・schema不一致はunknownへ倒してraw値を残さない", async () => {
    const networkFailure = await validateM2StagingHealth({
      apiBaseUrl: M2_STAGING_API_BASE_URL,
      frontendOrigin: M2_STAGING_FRONTEND_ORIGIN,
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("raw provider detail")),
    }).catch((error: unknown) => error);
    const schemaFailure = await validateM2StagingHealth({
      apiBaseUrl: M2_STAGING_API_BASE_URL,
      frontendOrigin: M2_STAGING_FRONTEND_ORIGIN,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(healthResponse({ status: "ok" })),
    }).catch((error: unknown) => error);

    expect(networkFailure).toBeInstanceOf(M2StagingHealthCheckError);
    expect(networkFailure).toMatchObject({ status: "unknown" });
    expect(schemaFailure).toMatchObject({ status: "unknown" });
    expect(String(networkFailure)).not.toContain("raw provider detail");
  });

  it("固定staging URL以外をrequest前に拒否する", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      validateM2StagingHealth({
        apiBaseUrl: "https://api.example.com/api/v1",
        frontendOrigin: M2_STAGING_FRONTEND_ORIGIN,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ status: "unknown" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
