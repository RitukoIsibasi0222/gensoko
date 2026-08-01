import { RATE_LIMIT_POLICIES, type RateLimitPolicy, type RateLimitPolicyId } from "./policies.js";
import type { RateLimitConsumeInput, RateLimitResult, RateLimitStore } from "./store.js";

const DEFAULT_MAX_ENTRIES = 10_000;
const MILLISECONDS_PER_SECOND = 1_000;

type InMemoryRateLimitEntry = {
  count: number;
  resetAtMs: number;
};

export type InMemoryRateLimitStoreOptions = Readonly<{
  now?: () => number;
  getPolicy?: (policyId: RateLimitPolicyId) => RateLimitPolicy;
  maxEntries?: number;
}>;

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, InMemoryRateLimitEntry>();
  private readonly now: () => number;
  private readonly getPolicy: (policyId: RateLimitPolicyId) => RateLimitPolicy;
  private readonly maxEntries: number;

  constructor({
    now = Date.now,
    getPolicy = (policyId) => RATE_LIMIT_POLICIES[policyId],
    maxEntries = DEFAULT_MAX_ENTRIES,
  }: InMemoryRateLimitStoreOptions = {}) {
    this.now = now;
    this.getPolicy = getPolicy;
    this.maxEntries = maxEntries;
  }

  async consume({ policyId, keyDigest }: RateLimitConsumeInput): Promise<RateLimitResult> {
    const policy = this.getPolicy(policyId);
    const nowMs = this.now();
    const storeKey = JSON.stringify([policyId, keyDigest]);
    const currentEntry = this.entries.get(storeKey);

    if (!currentEntry || nowMs >= currentEntry.resetAtMs) {
      if (!currentEntry) {
        this.makeSpaceForNewEntry(nowMs);
      }

      const resetAtMs = nowMs + policy.windowMs;
      this.entries.set(storeKey, { count: 1, resetAtMs });
      return this.createResult(policy, 1, resetAtMs, nowMs);
    }

    currentEntry.count += 1;
    return this.createResult(policy, currentEntry.count, currentEntry.resetAtMs, nowMs);
  }

  private createResult(
    policy: RateLimitPolicy,
    count: number,
    resetAtMs: number,
    nowMs: number,
  ): RateLimitResult {
    const allowed = count <= policy.limit;
    const remaining = Math.max(policy.limit - count, 0);
    const retryAfterSec = allowed
      ? 0
      : Math.max(0, Math.ceil((resetAtMs - nowMs) / MILLISECONDS_PER_SECOND));

    return {
      allowed,
      limit: policy.limit,
      remaining,
      resetAtMs,
      retryAfterSec,
    };
  }

  private makeSpaceForNewEntry(nowMs: number): void {
    if (this.entries.size < this.maxEntries) {
      return;
    }

    for (const [key, entry] of this.entries) {
      if (nowMs >= entry.resetAtMs) {
        this.entries.delete(key);
      }
    }

    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.entries.delete(oldestKey);
    }
  }
}
