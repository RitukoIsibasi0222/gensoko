import type { Context, MiddlewareHandler } from "hono";
import { createServiceUnavailableResponse } from "../../lib/http-error-responses.js";
import { RATE_LIMIT_POLICIES, type RateLimitPolicyId } from "./policies.js";
import type {
  RateLimitBucket,
  RateLimitBucketResolver,
  RateLimitKeyUnavailableEvent,
  RateLimitResult,
  RateLimitStore,
  RateLimitStoreErrorEvent,
  RateLimitStoreFactory,
} from "./store.js";

const RATE_LIMIT_EXCEEDED_MESSAGE = "リクエストが多すぎます。しばらく待ってから再試行してください";

export type RateLimitOptions = Readonly<{
  getStore: RateLimitStoreFactory;
  resolveBuckets: RateLimitBucketResolver;
  when?: (context: Context) => boolean | Promise<boolean>;
  onStoreError?: (event: RateLimitStoreErrorEvent) => void;
  onKeyUnavailable?: (event: RateLimitKeyUnavailableEvent) => void;
}>;

type BucketEvaluation = Readonly<{
  policyId: RateLimitPolicyId;
  result: RateLimitResult | null;
  storeError: boolean;
}>;

function defaultStoreErrorReporter(event: RateLimitStoreErrorEvent): void {
  console.error(`[${event.event}] policy=${event.policyId}`);
}

function defaultKeyUnavailableReporter(event: RateLimitKeyUnavailableEvent): void {
  console.error(`[${event.event}] policy=${event.policyId}`);
}

function hasFailClosedPolicy(policyIds: readonly RateLimitPolicyId[]): boolean {
  return policyIds.some((policyId) => RATE_LIMIT_POLICIES[policyId].failureMode === "fail-closed");
}

function createRateLimitExceededResponse(context: Context, retryAfterSec: number): Response {
  context.header("Retry-After", String(retryAfterSec));
  return context.json({ error: RATE_LIMIT_EXCEEDED_MESSAGE }, 429);
}

function createRateLimitStoreUnavailableResponse(context: Context): Response {
  return createServiceUnavailableResponse(context);
}

async function evaluateBucket(
  store: RateLimitStore,
  bucket: RateLimitBucket,
  reportStoreError: (event: RateLimitStoreErrorEvent) => void,
): Promise<BucketEvaluation> {
  try {
    const result = await store.consume({
      policyId: bucket.policyId,
      keyDigest: bucket.keyDigest!,
    });
    return { policyId: bucket.policyId, result, storeError: false };
  } catch {
    reportStoreError({ event: "rate_limit_store_error", policyId: bucket.policyId });
    return { policyId: bucket.policyId, result: null, storeError: true };
  }
}

export function rateLimit({
  getStore,
  resolveBuckets,
  when,
  onStoreError = defaultStoreErrorReporter,
  onKeyUnavailable = defaultKeyUnavailableReporter,
}: RateLimitOptions): MiddlewareHandler {
  return async (context, next) => {
    if (when && !(await when(context))) {
      return next();
    }

    const buckets = await resolveBuckets(context);
    const missingKeyPolicyIds = buckets
      .filter((bucket) => bucket.keyDigest === null)
      .map((bucket) => bucket.policyId);

    for (const policyId of missingKeyPolicyIds) {
      onKeyUnavailable({ event: "rate_limit_key_unavailable", policyId });
    }

    if (hasFailClosedPolicy(missingKeyPolicyIds)) {
      return createRateLimitStoreUnavailableResponse(context);
    }

    const validBuckets = buckets.filter(
      (bucket): bucket is RateLimitBucket & { keyDigest: string } => bucket.keyDigest !== null,
    );

    if (validBuckets.length === 0) {
      return next();
    }

    let store: RateLimitStore;
    try {
      store = getStore(context);
    } catch {
      const policyIds = validBuckets.map((bucket) => bucket.policyId);
      for (const policyId of policyIds) {
        onStoreError({ event: "rate_limit_store_error", policyId });
      }
      if (hasFailClosedPolicy(policyIds)) {
        return createRateLimitStoreUnavailableResponse(context);
      }
      return next();
    }

    const evaluations = await Promise.all(
      validBuckets.map((bucket) => evaluateBucket(store, bucket, onStoreError)),
    );
    const failClosedStoreErrors = evaluations.filter(
      (evaluation) =>
        evaluation.storeError &&
        RATE_LIMIT_POLICIES[evaluation.policyId].failureMode === "fail-closed",
    );

    if (failClosedStoreErrors.length > 0) {
      return createRateLimitStoreUnavailableResponse(context);
    }

    const limitedResults = evaluations
      .map((evaluation) => evaluation.result)
      .filter((result): result is RateLimitResult => result !== null && !result.allowed);

    if (limitedResults.length > 0) {
      const retryAfterSec = Math.max(...limitedResults.map((result) => result.retryAfterSec));
      return createRateLimitExceededResponse(context, retryAfterSec);
    }

    return next();
  };
}
