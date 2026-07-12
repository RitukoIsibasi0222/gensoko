import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppVariables } from "../../types/index.js";
import { createIpBucketResolver } from "./buckets.js";
import type { RateLimitPolicyId } from "./policies.js";
import type { RateLimitDependencies } from "./store.js";

const KEY_SECRET = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
type RateLimit = typeof import("./index.js").rateLimit;
let rateLimit: RateLimit;

beforeAll(async () => {
  vi.resetModules();
  vi.doUnmock("./index.js");
  ({ rateLimit } = await import("./index.js"));
});

function createApp(policyId: RateLimitPolicyId, dependencies: RateLimitDependencies) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use(async (context, next) => {
    context.set("rateLimit", dependencies);
    await next();
  });
  app.use(
    rateLimit({
      getStore: (context) => context.get("rateLimit").getStore(context),
      resolveBuckets: createIpBucketResolver(policyId),
      onKeyUnavailable: vi.fn(),
    }),
  );
  app.get("/", (context) => context.json({ ok: true }));
  return app;
}

describe("rate limit bucket resolution failures", () => {
  it("fails open for a general policy when the IP resolver throws", async () => {
    const consume = vi.fn();
    const app = createApp("GENERAL_API_IP", {
      getStore: () => ({ consume }),
      keySecret: KEY_SECRET,
      resolveIp: () => {
        throw new Error("raw resolver error");
      },
    });

    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(consume).not.toHaveBeenCalled();
  });

  it("fails closed for a sensitive policy when the IP resolver throws", async () => {
    const consume = vi.fn();
    const app = createApp("AUTH_IP", {
      getStore: () => ({ consume }),
      keySecret: KEY_SECRET,
      resolveIp: () => {
        throw new Error("raw resolver error");
      },
    });

    const response = await app.request("/");

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(consume).not.toHaveBeenCalled();
  });

  it("applies the policy failure mode when HMAC generation fails", async () => {
    const consume = vi.fn();
    const generalApp = createApp("GENERAL_API_IP", {
      getStore: () => ({ consume }),
      keySecret: "invalid-base64",
      resolveIp: () => "203.0.113.7",
    });
    const sensitiveApp = createApp("AUTH_IP", {
      getStore: () => ({ consume }),
      keySecret: "invalid-base64",
      resolveIp: () => "203.0.113.7",
    });

    expect((await generalApp.request("/")).status).toBe(200);
    expect((await sensitiveApp.request("/")).status).toBe(503);
    expect(consume).not.toHaveBeenCalled();
  });
});
