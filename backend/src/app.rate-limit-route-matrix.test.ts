import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RateLimitPolicyId } from "./middleware/rateLimit/policies.js";
import type { RateLimitConsumeInput, RateLimitResult } from "./middleware/rateLimit/store.js";

const KEY_SECRET = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");

type CreateApp = typeof import("./app.js").createApp;
let createApp: CreateApp;

beforeAll(async () => {
  vi.resetModules();
  vi.doUnmock("./middleware/rateLimit/index.js");
  ({ createApp } = await import("./app.js"));
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

function createPolicyApp(blockedPolicyId: RateLimitPolicyId) {
  const consume = vi.fn(async ({ policyId }: RateLimitConsumeInput) =>
    createDecision(policyId !== blockedPolicyId),
  );
  const app = createApp({
    isProduction: false,
    rateLimit: {
      getStore: () => ({ consume }),
      keySecret: KEY_SECRET,
      resolveIp: () => "203.0.113.7",
    },
  });
  return { app, consume };
}

function consumedPolicyIds(consume: ReturnType<typeof vi.fn>): RateLimitPolicyId[] {
  return consume.mock.calls.map(([input]) => (input as RateLimitConsumeInput).policyId);
}

describe("app rate limit route matrix", () => {
  it.each([
    "/api/v1/elements",
    "/api/v1/ranking/weekly",
    "/api/v1/weak",
    "/api/v1/users/me",
    "/api/v1/admin/stats",
    "/api/v1/game/sessions",
  ])("applies GENERAL_API_IP to %s", async (path) => {
    const { app, consume } = createPolicyApp("GENERAL_API_IP");

    const response = await app.request(path);

    expect(response.status).toBe(429);
    expect(consumedPolicyIds(consume)).toEqual(["GENERAL_API_IP"]);
  });

  it.each([
    "/api/v1/auth/register",
    "/api/v1/auth/login",
    "/api/v1/auth/forgot-password",
    "/api/v1/auth/reset-password",
  ])("applies shared AUTH_IP before validation to %s", async (path) => {
    const { app, consume } = createPolicyApp("AUTH_IP");

    const response = await app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(429);
    expect(consumedPolicyIds(consume)).toEqual(["GENERAL_API_IP", "AUTH_IP"]);
  });
});
