import type { Context } from "hono";
import {
  createRateLimitKeyDigest,
  normalizeRateLimitEmail,
  type RateLimitActorType,
} from "./key.js";
import type { RateLimitPolicyId } from "./policies.js";
import type {
  RateLimitBucket,
  RateLimitBucketResolver,
  RateLimitDependencies,
  RateLimitStore,
} from "./store.js";

type RateLimitContextVariables = {
  rateLimit: RateLimitDependencies;
  user?: { id: string };
};

function getDependencies(context: Context): RateLimitDependencies {
  return (context.var as unknown as RateLimitContextVariables).rateLimit;
}

/**
 * RouteのZod validator通過後にだけ呼ぶ、validated JSONの型境界。
 * 汎用MiddlewareHandlerではHonoのroute固有Input型が消えるため、この1箇所で復元する。
 */
export function getValidatedRateLimitJson<T>(context: Context): T {
  const request = context.req as unknown as { valid(target: "json"): T };
  return request.valid("json");
}

async function createBucket(input: {
  dependencies: RateLimitDependencies;
  policyId: RateLimitPolicyId;
  operationScope: string | null;
  actorType: RateLimitActorType;
  value: string | null;
}): Promise<RateLimitBucket> {
  if (input.value === null) {
    return { policyId: input.policyId, keyDigest: null };
  }

  try {
    const keyDigest = await createRateLimitKeyDigest({
      secret: input.dependencies.keySecret,
      policyId: input.policyId,
      operationScope: input.operationScope,
      actorType: input.actorType,
      value: input.value,
    });

    return { policyId: input.policyId, keyDigest };
  } catch {
    // runtimeのHMAC障害はraw errorを露出せず、キー取得不能として扱う。
    return { policyId: input.policyId, keyDigest: null };
  }
}

async function resolveIpSafely(
  dependencies: RateLimitDependencies,
  context: Context,
): Promise<string | null> {
  try {
    return await dependencies.resolveIp(context);
  } catch {
    // resolverのraw errorを露出せず、middlewareにpolicyのfailure modeを適用させる。
    return null;
  }
}

export function getRateLimitStore(context: Context): RateLimitStore {
  return getDependencies(context).getStore(context);
}

export function createIpBucketResolver(policyId: RateLimitPolicyId): RateLimitBucketResolver {
  return async (context) => {
    const dependencies = getDependencies(context);
    const ip = await resolveIpSafely(dependencies, context);
    return [
      await createBucket({
        dependencies,
        policyId,
        operationScope: null,
        actorType: "ip",
        value: ip,
      }),
    ];
  };
}

export function createUserBucketResolver(policyId: RateLimitPolicyId): RateLimitBucketResolver {
  return async (context) => {
    const dependencies = getDependencies(context);
    const user = (context.var as unknown as RateLimitContextVariables).user;
    return [
      await createBucket({
        dependencies,
        policyId,
        operationScope: null,
        actorType: "user",
        value: user?.id ?? null,
      }),
    ];
  };
}

export function createEmailBucketResolver(operationScope: string): RateLimitBucketResolver {
  return async (context) => {
    const dependencies = getDependencies(context);
    const payload = getValidatedRateLimitJson<{ email: string }>(context);
    const normalizedRateLimitEmail = normalizeRateLimitEmail(payload.email);
    return [
      await createBucket({
        dependencies,
        policyId: "AUTH_EMAIL",
        operationScope,
        actorType: "email",
        value: normalizedRateLimitEmail,
      }),
    ];
  };
}

export function createIpAndUserBucketResolver(input: {
  ipPolicyId: RateLimitPolicyId;
  userPolicyId: RateLimitPolicyId;
}): RateLimitBucketResolver {
  return async (context) => {
    const dependencies = getDependencies(context);
    const user = (context.var as unknown as RateLimitContextVariables).user;
    const ip = await resolveIpSafely(dependencies, context);
    return Promise.all([
      createBucket({
        dependencies,
        policyId: input.ipPolicyId,
        operationScope: null,
        actorType: "ip",
        value: ip,
      }),
      createBucket({
        dependencies,
        policyId: input.userPolicyId,
        operationScope: null,
        actorType: "user",
        value: user?.id ?? null,
      }),
    ]);
  };
}
