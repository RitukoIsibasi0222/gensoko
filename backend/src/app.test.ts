import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { RateLimitDependencies } from "./middleware/rateLimit/store.js";

const ALLOWED_ORIGIN = "http://localhost:5174";
const DISALLOWED_ORIGIN = "https://evil.example";
const EXPECTED_CSP =
  "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const EXPECTED_HSTS = "max-age=31536000; includeSubDomains";
const TEST_RATE_LIMIT_DEPENDENCIES: RateLimitDependencies = {
  getStore: () => ({
    consume: async ({ policyId }) => ({
      allowed: true,
      limit: 1,
      remaining: 0,
      resetAtMs: 60_000,
      retryAfterSec: policyId === "GENERAL_API_IP" ? 0 : 60,
    }),
  }),
  keySecret: Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
  resolveIp: () => "127.0.0.1",
};

const createConfiguredApp = (isProduction: boolean) => {
  vi.stubEnv("FRONTEND_URL", ALLOWED_ORIGIN);
  return createApp({ isProduction, rateLimit: TEST_RATE_LIMIT_DEPENDENCIES });
};

const createPreflightRequest = (origin: string) => ({
  method: "OPTIONS",
  headers: {
    Origin: origin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "Content-Type,Authorization",
  },
});

const expectSecurityHeaders = (response: Response) => {
  expect(response.headers.get("Content-Security-Policy")).toBe(EXPECTED_CSP);
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
};

describe("createApp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET / の既存レスポンスへセキュリティヘッダーを付与する", async () => {
    const response = await createConfiguredApp(false).request("/");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      message: "Gensoko API is running 🚀",
      version: "1.0.0",
    });
    expectSecurityHeaders(response);
  });

  it("healthレスポンスの既存shapeを維持してセキュリティヘッダーを付与する", async () => {
    const response = await createConfiguredApp(false).request("/api/v1/health");
    const body = (await response.json()) as { status: string; timestamp: string };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expectSecurityHeaders(response);
  });

  it("404レスポンスにもセキュリティヘッダーを付与する", async () => {
    const response = await createConfiguredApp(false).request("/not-found");

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "エンドポイントが見つかりません" });
    expectSecurityHeaders(response);
  });

  it("未捕捉例外を内部情報を含まない日本語JSONへ変換する", async () => {
    const app = createConfiguredApp(false);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    app.get("/test-unhandled-error", () => {
      throw new Error("DB接続先: postgres://secret@example.invalid");
    });

    try {
      const response = await app.request("/test-unhandled-error");

      expect(response.status).toBe(500);
      expect(response.headers.get("Content-Type")).toContain("application/json");
      expect(await response.json()).toEqual({ error: "サーバーエラーが発生しました" });
      expectSecurityHeaders(response);
      expect(consoleErrorSpy).toHaveBeenCalledWith("未捕捉のサーバーエラーが発生しました");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("認証なしの401レスポンスにもセキュリティヘッダーを付与する", async () => {
    const response = await createConfiguredApp(false).request("/api/v1/users/me");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "認証が必要です" });
    expectSecurityHeaders(response);
  });

  it("許可originのpreflightでCORSとセキュリティヘッダーを共存させる", async () => {
    const response = await createConfiguredApp(false).request(
      "/api/v1/auth/login",
      createPreflightRequest(ALLOWED_ORIGIN),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type,Authorization");
    expectSecurityHeaders(response);
  });

  it("未許可originをpreflightのallow-originへ反映しない", async () => {
    const response = await createConfiguredApp(false).request(
      "/api/v1/auth/login",
      createPreflightRequest(DISALLOWED_ORIGIN),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe(DISALLOWED_ORIGIN);
    expectSecurityHeaders(response);
  });

  it("production appだけHSTSを付与する", async () => {
    const productionResponse = await createConfiguredApp(true).request("/api/v1/health");
    const developmentResponse = await createConfiguredApp(false).request("/api/v1/health");

    expect(productionResponse.headers.get("Strict-Transport-Security")).toBe(EXPECTED_HSTS);
    expect(developmentResponse.headers.has("Strict-Transport-Security")).toBe(false);
  });

  it("productionでFRONTEND_URLが未設定ならapp構築時にfail-fastする", () => {
    vi.stubEnv("FRONTEND_URL", "");

    expect(() =>
      createApp({ isProduction: true, rateLimit: TEST_RATE_LIMIT_DEPENDENCIES }),
    ).toThrow("production環境ではFRONTEND_URLの設定が必要です");
  });

  it("developmentではFRONTEND_URL未設定時にlocalhostを許可する", async () => {
    vi.stubEnv("FRONTEND_URL", "");
    const response = await createApp({
      isProduction: false,
      rateLimit: TEST_RATE_LIMIT_DEPENDENCIES,
    }).request("/api/v1/auth/login", createPreflightRequest(ALLOWED_ORIGIN));

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
  });

  it("app factory分離後も既存の全route prefixを登録する", () => {
    const registeredPaths = createConfiguredApp(false).routes.map(({ path }) => path);
    const expectedPrefixes = [
      "/api/v1/auth",
      "/api/v1/admin",
      "/api/v1/elements",
      "/api/v1/game",
      "/api/v1/ranking",
      "/api/v1/users",
      "/api/v1/weak",
    ];

    for (const prefix of expectedPrefixes) {
      expect(registeredPaths.some((path) => path.startsWith(prefix))).toBe(true);
    }
  });
});
