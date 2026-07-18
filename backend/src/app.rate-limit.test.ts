import type { MiddlewareHandler } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RateLimitPolicyId } from "./middleware/rateLimit/policies.js";
import type { RateLimitConsumeInput, RateLimitResult } from "./middleware/rateLimit/store.js";
import type { AppVariables } from "./types/index.js";
import { createTestAppDependencies } from "./test/app-dependencies.js";

const CLIENT_IP = "203.0.113.7";
const ALLOWED_ORIGIN = "http://localhost:5174";
const EXPECTED_CSP =
  "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const KEY_SECRET = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
const VALID_REGISTER_BODY = {
  username: "rate_limit_user",
  email: "Target@Example.COM",
  password: "StrongPass1!",
};

type CreateApp = typeof import("./app.js").createApp;
let createApp: CreateApp;

const authenticatedUserMiddleware: MiddlewareHandler<{ Variables: AppVariables }> = async (
  context,
  next,
) => {
  context.set("user", { id: "user-1", role: "USER" });
  await next();
};

beforeAll(async () => {
  vi.resetModules();
  vi.doUnmock("./middleware/rateLimit/index.js");
  vi.doMock("./middleware/auth/index.js", () => ({
    authMiddleware: authenticatedUserMiddleware,
    optionalAuthMiddleware: authenticatedUserMiddleware,
  }));
  vi.doMock("./services/user.service.js", () => ({
    UserError: class UserError extends Error {
      constructor(
        message: string,
        public status: number,
      ) {
        super(message);
      }
    },
    changeCurrentPassword: vi.fn(),
    deleteCurrentUser: vi.fn(),
    getCurrentUserProfile: vi.fn(),
    getCurrentUserStats: vi.fn(),
    updateCurrentUsername: vi.fn().mockResolvedValue({
      user: { id: "user-1", username: "new_name", role: "USER" },
    }),
  }));
  ({ createApp } = await import("./app.js"));
});

afterAll(() => {
  vi.doUnmock("./middleware/auth/index.js");
  vi.doUnmock("./services/user.service.js");
});

function createDecision(allowed: boolean): RateLimitResult {
  return {
    allowed,
    limit: 10,
    remaining: allowed ? 9 : 0,
    resetAtMs: 60_000,
    retryAfterSec: allowed ? 0 : 30,
  };
}

function createAppWithConsume(consume: (input: RateLimitConsumeInput) => Promise<RateLimitResult>) {
  const consumeMock = vi.fn(consume);
  const testDependencies = createTestAppDependencies();
  const app = createApp({
    isProduction: false,
    frontendUrl: ALLOWED_ORIGIN,
    rateLimit: {
      getStore: () => ({ consume: consumeMock }),
      keySecret: KEY_SECRET,
      resolveIp: () => CLIENT_IP,
    },
    dependencies: {
      ...testDependencies,
      auth: {
        authMiddleware: authenticatedUserMiddleware,
        optionalAuthMiddleware: authenticatedUserMiddleware,
      },
      services: {
        ...testDependencies.services,
        users: {
          ...testDependencies.services.users,
          updateCurrentUsername: vi.fn().mockResolvedValue({
            user: { id: "user-1", username: "new_name", role: "USER" },
          }),
        },
      },
    },
  });

  return { app, consume: consumeMock };
}

function createRateLimitedApp(shouldAllow: (policyId: RateLimitPolicyId) => boolean) {
  return createAppWithConsume(async ({ policyId }) => createDecision(shouldAllow(policyId)));
}

function consumedPolicyIds(consume: ReturnType<typeof vi.fn>): RateLimitPolicyId[] {
  return consume.mock.calls.map(([input]) => (input as RateLimitConsumeInput).policyId);
}

describe("app rate limit integration", () => {
  it("root・health・OPTIONSを除外し、未知のapi routeはgeneral消費後に404を返す", async () => {
    const { app, consume } = createRateLimitedApp(() => true);

    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/api/v1/health")).status).toBe(200);
    expect(
      (
        await app.request("/api/v1/auth/login", {
          method: "OPTIONS",
          headers: {
            Origin: "http://localhost:5174",
            "Access-Control-Request-Method": "POST",
          },
        })
      ).status,
    ).toBe(204);
    expect(consume).not.toHaveBeenCalled();

    const unknownResponse = await app.request("/api/v1/not-found");

    expect(unknownResponse.status).toBe(404);
    expect(consumedPolicyIds(consume)).toEqual(["GENERAL_API_IP"]);
  });

  it("一般APIへGENERAL_API_IPを共通適用する", async () => {
    const { app, consume } = createRateLimitedApp((policyId) => policyId !== "GENERAL_API_IP");

    const response = await app.request("/api/v1/elements");

    expect(response.status).toBe(429);
    expect(consumedPolicyIds(consume)).toEqual(["GENERAL_API_IP"]);
  });

  it("429でもCORS・security header・Retry-After・日本語JSONを維持する", async () => {
    const { app } = createRateLimitedApp((policyId) => policyId !== "GENERAL_API_IP");

    const response = await app.request("/api/v1/elements", {
      headers: { Origin: ALLOWED_ORIGIN },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("Content-Security-Policy")).toBe(EXPECTED_CSP);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(await response.json()).toEqual({
      error: "リクエストが多すぎます。しばらく待ってから再試行してください",
    });
  });

  it("sensitive store障害の503でもCORS・security header・Retry-Afterを維持する", async () => {
    const { app } = createAppWithConsume(async ({ policyId }) => {
      if (policyId === "AUTH_IP") {
        throw new Error("secret store error");
      }
      return createDecision(true);
    });

    const response = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("Content-Security-Policy")).toBe(EXPECTED_CSP);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toEqual({
      error: "一時的に利用できません。しばらく待ってから再試行してください",
    });
  });

  it("認証routeはgeneral→AUTH_IPの順で不正bodyもIP bucketを消費する", async () => {
    const { app, consume } = createRateLimitedApp((policyId) => policyId !== "AUTH_IP");

    const response = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(429);
    expect(consumedPolicyIds(consume)).toEqual(["GENERAL_API_IP", "AUTH_IP"]);
  });

  it("register・login・forgotはZod後に操作別AUTH_EMAIL bucketを使う", async () => {
    const { app, consume } = createRateLimitedApp((policyId) => policyId !== "AUTH_EMAIL");
    const requests = [
      app.request("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(VALID_REGISTER_BODY),
      }),
      app.request("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: VALID_REGISTER_BODY.email, password: "password" }),
      }),
      app.request("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: VALID_REGISTER_BODY.email }),
      }),
    ];

    const responses = await Promise.all(requests);
    const emailCalls = consume.mock.calls
      .map(([input]) => input as RateLimitConsumeInput)
      .filter(({ policyId }) => policyId === "AUTH_EMAIL");

    expect(responses.map(({ status }) => status)).toEqual([429, 429, 429]);
    expect(emailCalls).toHaveLength(3);
    expect(new Set(emailCalls.map(({ keyDigest }) => keyDigest)).size).toBe(3);
  });

  it("questionsはgeneral→GAME_QUESTIONS_IPだけを消費する", async () => {
    const { app, consume } = createRateLimitedApp((policyId) => policyId !== "GAME_QUESTIONS_IP");

    const response = await app.request("/api/v1/game/questions?mode=SYMBOL_TO_NAME_LV1");

    expect(response.status).toBe(429);
    expect(consumedPolicyIds(consume)).toEqual(["GENERAL_API_IP", "GAME_QUESTIONS_IP"]);
  });

  it("game submitはgeneral→IP→auth→user→Zodの順で消費する", async () => {
    const { app, consume } = createRateLimitedApp((policyId) => policyId !== "GAME_SUBMIT_USER");

    const response = await app.request("/api/v1/game/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(429);
    expect(consumedPolicyIds(consume)).toEqual([
      "GENERAL_API_IP",
      "GAME_SUBMIT_IP",
      "GAME_SUBMIT_USER",
    ]);
  });

  it("game detailとhistoryはsubmit専用bucketを消費しない", async () => {
    const { app, consume } = createRateLimitedApp((policyId) => policyId !== "GENERAL_API_IP");

    const responses = await Promise.all([
      app.request("/api/v1/game/sessions/session-1"),
      app.request("/api/v1/game/sessions"),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([429, 429]);
    expect(consumedPolicyIds(consume)).toEqual(["GENERAL_API_IP", "GENERAL_API_IP"]);
  });

  it("username変更はaccount bucketを消費しない", async () => {
    const { app, consume } = createRateLimitedApp(() => true);

    const response = await app.request("/api/v1/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "new_name" }),
    });

    expect(response.status).toBe(200);
    expect(consumedPolicyIds(consume)).toEqual(["GENERAL_API_IP"]);
  });

  it("password変更はZod後にACCOUNT_IPとACCOUNT_USERを同じ段階で消費する", async () => {
    const { app, consume } = createRateLimitedApp((policyId) => policyId !== "ACCOUNT_USER");

    const response = await app.request("/api/v1/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "OldPass1!", newPassword: "NewPass1!" }),
    });

    expect(response.status).toBe(429);
    expect(consumedPolicyIds(consume)).toEqual(["GENERAL_API_IP", "ACCOUNT_IP", "ACCOUNT_USER"]);
  });

  it("account削除はZod前にACCOUNT_IPとACCOUNT_USERを同じ段階で消費する", async () => {
    const { app, consume } = createRateLimitedApp((policyId) => policyId !== "ACCOUNT_USER");

    const response = await app.request("/api/v1/users/me", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(429);
    expect(consumedPolicyIds(consume)).toEqual(["GENERAL_API_IP", "ACCOUNT_IP", "ACCOUNT_USER"]);
  });
});
