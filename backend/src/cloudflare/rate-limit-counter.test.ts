import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDurableObjectRateLimitStore } from "../middleware/rateLimit/durable-object-store.js";
import type { RateLimitPolicyId } from "../middleware/rateLimit/policies.js";
import type { RateLimitConsumeInput } from "../middleware/rateLimit/store.js";
import type { RateLimitCounter } from "./rate-limit-counter.js";

const AUTH_LIMIT = 10;
const VALID_KEY_DIGEST = "a".repeat(64);

type TestEnvironment = Readonly<{
  RATE_LIMIT_COUNTER: DurableObjectNamespace<RateLimitCounter>;
}>;

type CounterStateRow = Readonly<{
  count: number;
  resetAtMs: number;
}>;

function getNamespace(): DurableObjectNamespace<RateLimitCounter> {
  return (env as unknown as TestEnvironment).RATE_LIMIT_COUNTER;
}

function createInput(keyDigest = VALID_KEY_DIGEST): RateLimitConsumeInput {
  return { policyId: "AUTH_IP", keyDigest };
}

function getStub(objectName: string): DurableObjectStub<RateLimitCounter> {
  const namespace = getNamespace();
  return namespace.get(namespace.idFromName(objectName));
}

async function readState(stub: DurableObjectStub<RateLimitCounter>) {
  return runInDurableObject(stub, async (_instance, state) =>
    state.storage.sql
      .exec<CounterStateRow>(
        "SELECT count, reset_at_ms AS resetAtMs FROM rate_limit_state WHERE singleton = 1",
      )
      .toArray(),
  );
}

describe("RateLimitCounter", () => {
  it("同一objectへの並行consumeでも許可件数がpolicy limitを超えない", async () => {
    const stub = getStub("parallel");

    const results = await Promise.all(
      Array.from({ length: 40 }, () => stub.consume(createInput())),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(AUTH_LIMIT);
    expect(results.filter((result) => !result.allowed)).toHaveLength(30);
    expect(new Set(results.map((result) => result.resetAtMs)).size).toBe(1);
  });

  it("countとresetAtだけをSQLiteへ永続化する", async () => {
    const stub = getStub("sqlite-state");

    await stub.consume(createInput());
    await stub.consume(createInput());

    const rows = await readState(stub);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(2);
    expect(rows[0]?.resetAtMs).toBeGreaterThan(Date.now());
  });

  it("instance eviction後も同じobjectのcountをSQLiteから継続する", async () => {
    const namespace = getNamespace();
    const id = namespace.idFromName("eviction");
    const firstStub = namespace.get(id);

    await firstStub.consume(createInput());
    await firstStub.consume(createInput());
    await evictDurableObject(firstStub);

    const result = await namespace.get(id).consume(createInput());
    expect(result).toMatchObject({
      allowed: true,
      limit: AUTH_LIMIT,
      remaining: AUTH_LIMIT - 3,
    });
  });

  it("期限到達済みstateは次のconsumeで新windowへ切り替える", async () => {
    const stub = getStub("expired-window");
    await stub.consume(createInput());

    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE rate_limit_state SET count = ?, reset_at_ms = ? WHERE singleton = 1",
        AUTH_LIMIT,
        Date.now(),
      );
    });

    await expect(stub.consume(createInput())).resolves.toMatchObject({
      allowed: true,
      limit: AUTH_LIMIT,
      remaining: AUTH_LIMIT - 1,
      retryAfterSec: 0,
    });
    await expect(readState(stub)).resolves.toMatchObject([{ count: 1 }]);
  });

  it("alarmで期限到達済みstateを削除する", async () => {
    const stub = getStub("alarm-cleanup");
    await stub.consume(createInput());

    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
      state.storage.sql.exec(
        "UPDATE rate_limit_state SET reset_at_ms = ? WHERE singleton = 1",
        Date.now() - 1,
      );
    });

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    await expect(readState(stub)).resolves.toEqual([]);
  });

  it("期限前にalarmが起動しても現windowを削除せず再設定する", async () => {
    const stub = getStub("early-alarm");
    await stub.consume(createInput());

    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    await expect(readState(stub)).resolves.toMatchObject([{ count: 1 }]);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });
});

describe("createDurableObjectRateLimitStore", () => {
  it("policyとdigestから分散objectを選び、typed RPC結果を返す", async () => {
    const store = createDurableObjectRateLimitStore(getNamespace());

    const first = await store.consume(createInput("b".repeat(64)));
    const second = await store.consume(createInput("b".repeat(64)));
    const otherKey = await store.consume(createInput("c".repeat(64)));
    const otherPolicy = await store.consume({
      policyId: "ACCOUNT_IP",
      keyDigest: "b".repeat(64),
    });

    expect(first).toMatchObject({ allowed: true, remaining: AUTH_LIMIT - 1 });
    expect(second).toMatchObject({ allowed: true, remaining: AUTH_LIMIT - 2 });
    expect(otherKey).toMatchObject({ allowed: true, remaining: AUTH_LIMIT - 1 });
    expect(otherPolicy).toMatchObject({ allowed: true, remaining: AUTH_LIMIT - 1 });
  });

  it("HMAC-SHA-256以外のdigestをDO object名へ渡さず拒否する", async () => {
    const store = createDurableObjectRateLimitStore(getNamespace());

    await expect(
      store.consume({ policyId: "AUTH_IP", keyDigest: "raw-user@example.test" }),
    ).rejects.toThrow("rate limit keyが不正です");
  });

  it("未知のpolicyをDO object名へ渡さず拒否する", async () => {
    const store = createDurableObjectRateLimitStore(getNamespace());

    await expect(
      store.consume({
        policyId: "UNKNOWN" as RateLimitPolicyId,
        keyDigest: VALID_KEY_DIGEST,
      }),
    ).rejects.toThrow("rate limit policyが不正です");
  });

  it("RPC結果を検証し不正な値をapplicationへ返さない", async () => {
    const namespace = {
      idFromName: () => ({}) as DurableObjectId,
      get: () => ({
        consume: async () => ({
          allowed: true,
          limit: AUTH_LIMIT,
          remaining: -1,
          resetAtMs: Date.now() + 60_000,
          retryAfterSec: 0,
        }),
      }),
    } as unknown as DurableObjectNamespace<RateLimitCounter>;
    const store = createDurableObjectRateLimitStore(namespace);

    await expect(store.consume(createInput())).rejects.toThrow("rate limit結果が不正です");
  });

  it("RPC結果がobjectでない場合も安全な固定エラーで拒否する", async () => {
    const namespace = {
      idFromName: () => ({}) as DurableObjectId,
      get: () => ({ consume: async () => null }),
    } as unknown as DurableObjectNamespace<RateLimitCounter>;
    const store = createDurableObjectRateLimitStore(namespace);

    await expect(store.consume(createInput())).rejects.toThrow("rate limit結果が不正です");
  });

  it("拒否結果のRetry-Afterが正でない場合は拒否する", async () => {
    const namespace = {
      idFromName: () => ({}) as DurableObjectId,
      get: () => ({
        consume: async () => ({
          allowed: false,
          limit: AUTH_LIMIT,
          remaining: 0,
          resetAtMs: Date.now() + 60_000,
          retryAfterSec: 0,
        }),
      }),
    } as unknown as DurableObjectNamespace<RateLimitCounter>;
    const store = createDurableObjectRateLimitStore(namespace);

    await expect(store.consume(createInput())).rejects.toThrow("rate limit結果が不正です");
  });
});
