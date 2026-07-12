import type { Context } from "hono";
import type { RateLimitPolicyId } from "./policies.js";

export type RateLimitResult = Readonly<{
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSec: number;
}>;

export type RateLimitConsumeInput = Readonly<{
  policyId: RateLimitPolicyId;
  keyDigest: string;
}>;

export interface RateLimitStore {
  consume(input: RateLimitConsumeInput): Promise<RateLimitResult>;
}

export type RateLimitBucket = Readonly<{
  policyId: RateLimitPolicyId;
  keyDigest: string | null;
}>;

export type RateLimitStoreFactory = (context: Context) => RateLimitStore;
export type RateLimitIpResolver = (context: Context) => string | null | Promise<string | null>;

export type RateLimitDependencies = Readonly<{
  getStore: RateLimitStoreFactory;
  keySecret: string;
  resolveIp: RateLimitIpResolver;
}>;

export type RateLimitBucketResolver = (
  context: Context,
) => Promise<readonly RateLimitBucket[]> | readonly RateLimitBucket[];

export type RateLimitStoreErrorEvent = Readonly<{
  event: "rate_limit_store_error";
  policyId: RateLimitPolicyId;
}>;

export type RateLimitKeyUnavailableEvent = Readonly<{
  event: "rate_limit_key_unavailable";
  policyId: RateLimitPolicyId;
}>;
