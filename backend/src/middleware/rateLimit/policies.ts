const ONE_MINUTE_MS = 60_000;
const TEN_MINUTES_MS = 10 * ONE_MINUTE_MS;

export type RateLimitPolicyId =
  | "GENERAL_API_IP"
  | "AUTH_IP"
  | "AUTH_EMAIL"
  | "ACCOUNT_IP"
  | "ACCOUNT_USER"
  | "GAME_QUESTIONS_IP"
  | "GAME_SUBMIT_IP"
  | "GAME_SUBMIT_USER";

export type RateLimitFailureMode = "fail-open" | "fail-closed";

export type RateLimitPolicy = Readonly<{
  id: RateLimitPolicyId;
  limit: number;
  windowMs: number;
  failureMode: RateLimitFailureMode;
}>;

export const RATE_LIMIT_POLICIES = {
  GENERAL_API_IP: {
    id: "GENERAL_API_IP",
    limit: 60,
    windowMs: ONE_MINUTE_MS,
    failureMode: "fail-open",
  },
  AUTH_IP: {
    id: "AUTH_IP",
    limit: 10,
    windowMs: TEN_MINUTES_MS,
    failureMode: "fail-closed",
  },
  AUTH_EMAIL: {
    id: "AUTH_EMAIL",
    limit: 10,
    windowMs: TEN_MINUTES_MS,
    failureMode: "fail-closed",
  },
  ACCOUNT_IP: {
    id: "ACCOUNT_IP",
    limit: 10,
    windowMs: TEN_MINUTES_MS,
    failureMode: "fail-closed",
  },
  ACCOUNT_USER: {
    id: "ACCOUNT_USER",
    limit: 10,
    windowMs: TEN_MINUTES_MS,
    failureMode: "fail-closed",
  },
  GAME_QUESTIONS_IP: {
    id: "GAME_QUESTIONS_IP",
    limit: 30,
    windowMs: ONE_MINUTE_MS,
    failureMode: "fail-open",
  },
  GAME_SUBMIT_IP: {
    id: "GAME_SUBMIT_IP",
    limit: 20,
    windowMs: ONE_MINUTE_MS,
    failureMode: "fail-closed",
  },
  GAME_SUBMIT_USER: {
    id: "GAME_SUBMIT_USER",
    limit: 20,
    windowMs: ONE_MINUTE_MS,
    failureMode: "fail-closed",
  },
} as const satisfies Readonly<Record<RateLimitPolicyId, RateLimitPolicy>>;

export function isRateLimitPolicyId(value: unknown): value is RateLimitPolicyId {
  return typeof value === "string" && Object.hasOwn(RATE_LIMIT_POLICIES, value);
}
