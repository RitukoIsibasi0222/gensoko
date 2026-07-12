import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.doUnmock("./index.js");

type RateLimitModule = typeof import("./index.js");
let rateLimit: RateLimitModule["rateLimit"];

beforeAll(async () => {
  vi.resetModules();
  ({ rateLimit } = await import("./index.js"));
});

function createResult({
  allowed,
  retryAfterSec = 0,
}: {
  allowed: boolean;
  retryAfterSec?: number;
}) {
  return {
    allowed,
    limit: 10,
    remaining: allowed ? 9 : 0,
    resetAtMs: 60_000,
    retryAfterSec,
  };
}

function createApp(options: Parameters<RateLimitModule["rateLimit"]>[0]) {
  const app = new Hono();
  app.use(rateLimit(options));
  app.get("/", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit middleware", () => {
  it("同じ段階の全bucketが許可された場合だけhandlerへ進む", async () => {
    const consume = vi.fn().mockResolvedValue(createResult({ allowed: true }));
    const app = createApp({
      getStore: () => ({ consume }),
      resolveBuckets: async () => [
        { policyId: "GAME_SUBMIT_IP", keyDigest: "ip-digest" },
        { policyId: "GAME_SUBMIT_USER", keyDigest: "user-digest" },
      ],
    });

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(consume).toHaveBeenNthCalledWith(1, {
      policyId: "GAME_SUBMIT_IP",
      keyDigest: "ip-digest",
    });
    expect(consume).toHaveBeenNthCalledWith(2, {
      policyId: "GAME_SUBMIT_USER",
      keyDigest: "user-digest",
    });
  });

  it("先頭bucketが超過していても同じ段階の全bucketを試行する", async () => {
    const consume = vi
      .fn()
      .mockResolvedValueOnce(createResult({ allowed: false, retryAfterSec: 10 }))
      .mockResolvedValueOnce(createResult({ allowed: true }));
    const app = createApp({
      getStore: () => ({ consume }),
      resolveBuckets: async () => [
        { policyId: "GAME_SUBMIT_IP", keyDigest: "ip-digest" },
        { policyId: "GAME_SUBMIT_USER", keyDigest: "user-digest" },
      ],
    });

    const response = await app.request("/");

    expect(response.status).toBe(429);
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it("複数bucket超過時は最大Retry-Afterと日本語JSONを返す", async () => {
    const consume = vi
      .fn()
      .mockResolvedValueOnce(createResult({ allowed: false, retryAfterSec: 12 }))
      .mockResolvedValueOnce(createResult({ allowed: false, retryAfterSec: 47 }));
    const app = createApp({
      getStore: () => ({ consume }),
      resolveBuckets: async () => [
        { policyId: "GAME_SUBMIT_IP", keyDigest: "ip-digest" },
        { policyId: "GAME_SUBMIT_USER", keyDigest: "user-digest" },
      ],
    });

    const response = await app.request("/");

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("47");
    await expect(response.json()).resolves.toEqual({
      error: "リクエストが多すぎます。しばらく待ってから再試行してください",
    });
  });

  it("fail-closed policyのstore障害時は503を優先する", async () => {
    const consume = vi
      .fn()
      .mockResolvedValueOnce(createResult({ allowed: false, retryAfterSec: 20 }))
      .mockRejectedValueOnce(new Error("接続先や秘密情報を含み得るraw error"));
    const onStoreError = vi.fn();
    const app = createApp({
      getStore: () => ({ consume }),
      resolveBuckets: async () => [
        { policyId: "GAME_SUBMIT_IP", keyDigest: "ip-digest" },
        { policyId: "GAME_SUBMIT_USER", keyDigest: "user-digest" },
      ],
      onStoreError,
    });

    const response = await app.request("/");

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toEqual({
      error: "一時的に利用できません。しばらく待ってから再試行してください",
    });
    expect(onStoreError).toHaveBeenCalledWith({
      event: "rate_limit_store_error",
      policyId: "GAME_SUBMIT_USER",
    });
    expect(JSON.stringify(onStoreError.mock.calls)).not.toContain("raw error");
  });

  it("fail-open policyのstore障害時は固定eventを記録してhandlerへ進む", async () => {
    const consume = vi.fn().mockRejectedValue(new Error("raw error"));
    const onStoreError = vi.fn();
    const app = createApp({
      getStore: () => ({ consume }),
      resolveBuckets: async () => [{ policyId: "GENERAL_API_IP", keyDigest: "ip-digest" }],
      onStoreError,
    });

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(onStoreError).toHaveBeenCalledWith({
      event: "rate_limit_store_error",
      policyId: "GENERAL_API_IP",
    });
    expect(JSON.stringify(onStoreError.mock.calls)).not.toContain("raw error");
  });

  it("fail-closed policyのkey欠損時はunknown bucketを作らず503を返す", async () => {
    const consume = vi.fn();
    const onKeyUnavailable = vi.fn();
    const app = createApp({
      getStore: () => ({ consume }),
      resolveBuckets: async () => [{ policyId: "AUTH_IP", keyDigest: null }],
      onKeyUnavailable,
    });

    const response = await app.request("/");

    expect(response.status).toBe(503);
    expect(consume).not.toHaveBeenCalled();
    expect(onKeyUnavailable).toHaveBeenCalledWith({
      event: "rate_limit_key_unavailable",
      policyId: "AUTH_IP",
    });
  });

  it("fail-open policyのkey欠損時はunknown bucketを作らずhandlerへ進む", async () => {
    const consume = vi.fn();
    const resolveBuckets = vi.fn(async () => [
      { policyId: "GENERAL_API_IP" as const, keyDigest: null },
    ]);
    const onKeyUnavailable = vi.fn();
    const app = createApp({
      getStore: () => ({ consume }),
      resolveBuckets,
      onKeyUnavailable,
    });

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(resolveBuckets).toHaveBeenCalledOnce();
    expect(consume).not.toHaveBeenCalled();
    expect(onKeyUnavailable).toHaveBeenCalledWith({
      event: "rate_limit_key_unavailable",
      policyId: "GENERAL_API_IP",
    });
  });

  it("whenがfalseの場合はbucket解決とstore取得を行わない", async () => {
    const getStore = vi.fn();
    const resolveBuckets = vi.fn();
    const when = vi.fn(() => false);
    const app = createApp({
      getStore,
      resolveBuckets,
      when,
    });

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(when).toHaveBeenCalledOnce();
    expect(getStore).not.toHaveBeenCalled();
    expect(resolveBuckets).not.toHaveBeenCalled();
  });
});
