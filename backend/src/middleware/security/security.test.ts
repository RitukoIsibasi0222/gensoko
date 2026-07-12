import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createSecurityHeadersMiddleware } from "./index.js";

const EXPECTED_CSP =
  "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const EXPECTED_HSTS = "max-age=31536000; includeSubDomains";
const EXPECTED_PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=()";

const createTestApp = (isProduction: boolean) => {
  const app = new Hono();

  app.use("*", createSecurityHeadersMiddleware({ isProduction }));
  app.get("/", (c) => c.json({ ok: true }));
  app.get("/error", () => {
    throw new Error("テスト用エラー");
  });
  app.get("/overridden", (c) => {
    c.header("Content-Security-Policy", "default-src *");
    c.header("X-Frame-Options", "SAMEORIGIN");
    return c.json({ ok: true });
  });

  return app;
};

const expectCommonSecurityHeaders = (response: Response) => {
  expect(response.headers.get("Content-Security-Policy")).toBe(EXPECTED_CSP);
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  expect(response.headers.get("Permissions-Policy")).toBe(EXPECTED_PERMISSIONS_POLICY);
  expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  expect(response.headers.get("X-XSS-Protection")).toBe("0");
  expect(response.headers.get("X-Permitted-Cross-Domain-Policies")).toBe("none");
  expect(response.headers.has("X-Powered-By")).toBe(false);
};

describe("createSecurityHeadersMiddleware", () => {
  it("developmentの200 JSONへHSTS以外の採用ヘッダーを正確に付与する", async () => {
    const response = await createTestApp(false).request("/");

    expect(response.status).toBe(200);
    expectCommonSecurityHeaders(response);
    expect(response.headers.has("Strict-Transport-Security")).toBe(false);
  });

  it("productionではHSTSを1年間・全サブドメイン対象で付与する", async () => {
    const response = await createTestApp(true).request("/");

    expect(response.headers.get("Strict-Transport-Security")).toBe(EXPECTED_HSTS);
  });

  it("API用CSPをdeny-by-defaultにし、scriptやstyleを許可しない", async () => {
    const response = await createTestApp(false).request("/");
    const csp = response.headers.get("Content-Security-Policy");

    expect(csp).toBe(EXPECTED_CSP);
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("style-src");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it("APIで採用しないcross-origin・legacyヘッダーを付与しない", async () => {
    const response = await createTestApp(false).request("/");

    expect(response.headers.has("Cross-Origin-Opener-Policy")).toBe(false);
    expect(response.headers.has("Cross-Origin-Embedder-Policy")).toBe(false);
    expect(response.headers.has("Origin-Agent-Cluster")).toBe(false);
    expect(response.headers.has("X-DNS-Prefetch-Control")).toBe(false);
    expect(response.headers.has("X-Download-Options")).toBe(false);
  });

  it("routeが同名ヘッダーを設定しても中央ポリシーで上書きする", async () => {
    const response = await createTestApp(false).request("/overridden");

    expect(response.headers.get("Content-Security-Policy")).toBe(EXPECTED_CSP);
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("downstreamの500レスポンスにもヘッダーを付与しstatusとbodyを変えない", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const response = await createTestApp(false).request("/error");

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Internal Server Error");
      expectCommonSecurityHeaders(response);
      expect(consoleErrorSpy).toHaveBeenCalledOnce();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("正常レスポンスのJSON bodyを変更しない", async () => {
    const response = await createTestApp(false).request("/");

    expect(await response.json()).toEqual({ ok: true });
  });
});
