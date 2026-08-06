import { describe, expect, it, vi } from "vitest";

import {
  ProductionReleaseHealthError,
  validateProductionReleaseHealth,
} from "./productionReleaseHealth.js";

const API_BASE_URL = "https://api.gensoko.example.co/api/v1";
const FRONTEND_ORIGIN = "https://www.gensoko.example.co";
const SAFE_HEADERS = {
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
  "Content-Security-Policy":
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "Content-Type": "application/json",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "0",
};

function healthResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...SAFE_HEADERS, ...headers },
  });
}

describe("production release health", () => {
  it("production APIのGET health・CORS・security headerをread-only検証する", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(healthResponse({ status: "ok", timestamp: "2026-08-06T00:00:00.000Z" }));

    await expect(
      validateProductionReleaseHealth({
        apiBaseUrl: API_BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        fetchImpl,
      }),
    ).resolves.toEqual({ status: "clear" });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${API_BASE_URL}/health`,
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it.each([
    healthResponse({ status: "ok" }),
    healthResponse(
      { status: "ok", timestamp: "2026-08-06T00:00:00.000Z" },
      { "Access-Control-Allow-Origin": "https://invalid.example" },
    ),
    new Response("redirect", { status: 302 }),
  ])("body・header・status異常を固定errorへ縮約する", async (response) => {
    const failure = await validateProductionReleaseHealth({
      apiBaseUrl: API_BASE_URL,
      frontendOrigin: FRONTEND_ORIGIN,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProductionReleaseHealthError);
    expect(String(failure)).not.toContain("invalid.example");
  });

  it("provider domain・HTTP・path付きoriginはrequest前に拒否する", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      validateProductionReleaseHealth({
        apiBaseUrl: "https://example.workers.dev/api/v1",
        frontendOrigin: FRONTEND_ORIGIN,
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(ProductionReleaseHealthError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
