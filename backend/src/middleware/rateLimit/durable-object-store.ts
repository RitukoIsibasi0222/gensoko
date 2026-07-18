import type { RateLimitCounter } from "../../cloudflare/rate-limit-counter.js";
import { isRateLimitPolicyId, RATE_LIMIT_POLICIES } from "./policies.js";
import {
  isRateLimitKeyDigest,
  type RateLimitConsumeInput,
  type RateLimitResult,
  type RateLimitStore,
} from "./store.js";

const INVALID_KEY_MESSAGE = "rate limit keyが不正です";
const INVALID_POLICY_MESSAGE = "rate limit policyが不正です";
const INVALID_RESULT_MESSAGE = "rate limit結果が不正です";

function validateResult(input: RateLimitConsumeInput, result: unknown): RateLimitResult {
  const policy = RATE_LIMIT_POLICIES[input.policyId];

  if (typeof result !== "object" || result === null) {
    throw new Error(INVALID_RESULT_MESSAGE);
  }

  const { allowed, limit, remaining, resetAtMs, retryAfterSec } = result as Record<string, unknown>;
  const isValid =
    typeof allowed === "boolean" &&
    limit === policy.limit &&
    Number.isInteger(remaining) &&
    (remaining as number) >= 0 &&
    (remaining as number) <= policy.limit &&
    Number.isInteger(resetAtMs) &&
    (resetAtMs as number) >= 0 &&
    Number.isInteger(retryAfterSec) &&
    (retryAfterSec as number) >= 0 &&
    (allowed ? retryAfterSec === 0 : remaining === 0 && (retryAfterSec as number) > 0);

  if (!isValid) {
    throw new Error(INVALID_RESULT_MESSAGE);
  }

  return {
    allowed,
    limit: limit as number,
    remaining: remaining as number,
    resetAtMs: resetAtMs as number,
    retryAfterSec: retryAfterSec as number,
  };
}

export function createDurableObjectRateLimitStore(
  namespace: DurableObjectNamespace<RateLimitCounter>,
): RateLimitStore {
  return {
    async consume(input) {
      if (!isRateLimitPolicyId(input.policyId)) {
        throw new Error(INVALID_POLICY_MESSAGE);
      }

      if (!isRateLimitKeyDigest(input.keyDigest)) {
        throw new Error(INVALID_KEY_MESSAGE);
      }

      const objectName = JSON.stringify([input.policyId, input.keyDigest]);
      const stub = namespace.get(namespace.idFromName(objectName));
      const result: unknown = await stub.consume(input);

      return validateResult(input, result);
    },
  };
}
