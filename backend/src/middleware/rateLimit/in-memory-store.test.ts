import { describe, expect, it } from "vitest";
import { InMemoryRateLimitStore } from "./in-memory-store.js";
import type { RateLimitPolicy, RateLimitPolicyId } from "./policies.js";

const TEST_POLICY: RateLimitPolicy = {
  id: "GENERAL_API_IP",
  limit: 2,
  windowMs: 1_500,
  failureMode: "fail-open",
};

const SECOND_POLICY: RateLimitPolicy = {
  id: "AUTH_IP",
  limit: 1,
  windowMs: 1_500,
  failureMode: "fail-closed",
};

function createStore(now: () => number) {
  const policies: Partial<Record<RateLimitPolicyId, RateLimitPolicy>> = {
    GENERAL_API_IP: TEST_POLICY,
    AUTH_IP: SECOND_POLICY,
  };

  return new InMemoryRateLimitStore({
    now,
    getPolicy: (policyId) => {
      const policy = policies[policyId];
      if (!policy) {
        throw new Error(`test policyがありません: ${policyId}`);
      }
      return policy;
    },
  });
}

describe("InMemoryRateLimitStore", () => {
  it("limit未満とちょうどlimitまでは許可し、remainingを減らす", async () => {
    const store = createStore(() => 1_000);

    await expect(
      store.consume({ policyId: "GENERAL_API_IP", keyDigest: "digest-a" }),
    ).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAtMs: 2_500,
      retryAfterSec: 0,
    });
    await expect(
      store.consume({ policyId: "GENERAL_API_IP", keyDigest: "digest-a" }),
    ).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
      resetAtMs: 2_500,
      retryAfterSec: 0,
    });
  });

  it("limit超過時は拒否し、待ち時間を秒単位で切り上げる", async () => {
    const store = createStore(() => 1_000);

    await store.consume({ policyId: "GENERAL_API_IP", keyDigest: "digest-a" });
    await store.consume({ policyId: "GENERAL_API_IP", keyDigest: "digest-a" });

    await expect(
      store.consume({ policyId: "GENERAL_API_IP", keyDigest: "digest-a" }),
    ).resolves.toEqual({
      allowed: false,
      limit: 2,
      remaining: 0,
      resetAtMs: 2_500,
      retryAfterSec: 2,
    });
  });

  it("nowがresetAtと等しい場合は新しいwindowとして許可する", async () => {
    let now = 1_000;
    const store = createStore(() => now);

    await store.consume({ policyId: "GENERAL_API_IP", keyDigest: "digest-a" });
    await store.consume({ policyId: "GENERAL_API_IP", keyDigest: "digest-a" });
    now = 2_500;

    await expect(
      store.consume({ policyId: "GENERAL_API_IP", keyDigest: "digest-a" }),
    ).resolves.toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetAtMs: 4_000,
      retryAfterSec: 0,
    });
  });

  it("異なるkeyDigestを独立して数える", async () => {
    const store = createStore(() => 1_000);

    await store.consume({ policyId: "GENERAL_API_IP", keyDigest: "digest-a" });
    await store.consume({ policyId: "GENERAL_API_IP", keyDigest: "digest-a" });

    await expect(
      store.consume({ policyId: "GENERAL_API_IP", keyDigest: "digest-b" }),
    ).resolves.toMatchObject({ allowed: true, remaining: 1 });
  });

  it("同じkeyDigestでもpolicyIdが異なれば独立して数える", async () => {
    const store = createStore(() => 1_000);

    await store.consume({ policyId: "GENERAL_API_IP", keyDigest: "shared-digest" });
    await store.consume({ policyId: "GENERAL_API_IP", keyDigest: "shared-digest" });

    await expect(
      store.consume({ policyId: "AUTH_IP", keyDigest: "shared-digest" }),
    ).resolves.toMatchObject({ allowed: true, remaining: 0 });
  });

  it("同時consumeでも許可件数がlimitを超えない", async () => {
    const store = createStore(() => 1_000);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.consume({ policyId: "GENERAL_API_IP", keyDigest: "digest-a" }),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(2);
    expect(results.filter((result) => !result.allowed)).toHaveLength(8);
  });
});
