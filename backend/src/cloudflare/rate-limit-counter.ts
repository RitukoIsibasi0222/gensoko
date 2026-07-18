import { DurableObject } from "cloudflare:workers";
import { isRateLimitPolicyId, RATE_LIMIT_POLICIES } from "../middleware/rateLimit/policies.js";
import {
  isRateLimitKeyDigest,
  type RateLimitConsumeInput,
  type RateLimitResult,
} from "../middleware/rateLimit/store.js";

const MILLISECONDS_PER_SECOND = 1_000;

type CounterStateRow = Readonly<{
  count: number;
  resetAtMs: number;
}>;

type CounterTransition = CounterStateRow &
  Readonly<{
    startedNewWindow: boolean;
  }>;

function validateConsumeInput(input: RateLimitConsumeInput): void {
  if (!isRateLimitPolicyId(input.policyId) || !isRateLimitKeyDigest(input.keyDigest)) {
    throw new Error("rate limit入力が不正です");
  }
}

export class RateLimitCounter extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rate_limit_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        count INTEGER NOT NULL CHECK (count >= 1),
        reset_at_ms INTEGER NOT NULL
      ) STRICT
    `);
  }

  async consume(input: RateLimitConsumeInput): Promise<RateLimitResult> {
    validateConsumeInput(input);

    const policy = RATE_LIMIT_POLICIES[input.policyId];
    const nowMs = Date.now();
    const transition = this.ctx.storage.transactionSync<CounterTransition>(() => {
      const current = this.ctx.storage.sql
        .exec<CounterStateRow>(
          "SELECT count, reset_at_ms AS resetAtMs FROM rate_limit_state WHERE singleton = 1",
        )
        .toArray()[0];

      if (!current || nowMs >= current.resetAtMs) {
        const resetAtMs = nowMs + policy.windowMs;
        this.ctx.storage.sql.exec(
          `INSERT INTO rate_limit_state (singleton, count, reset_at_ms)
           VALUES (1, 1, ?)
           ON CONFLICT(singleton) DO UPDATE SET count = 1, reset_at_ms = excluded.reset_at_ms`,
          resetAtMs,
        );
        return { count: 1, resetAtMs, startedNewWindow: true };
      }

      const count = current.count + 1;
      this.ctx.storage.sql.exec("UPDATE rate_limit_state SET count = ? WHERE singleton = 1", count);
      return {
        count,
        resetAtMs: current.resetAtMs,
        startedNewWindow: false,
      };
    });

    if (transition.startedNewWindow) {
      await this.ctx.storage.setAlarm(transition.resetAtMs);
    }

    const allowed = transition.count <= policy.limit;
    return {
      allowed,
      limit: policy.limit,
      remaining: Math.max(policy.limit - transition.count, 0),
      resetAtMs: transition.resetAtMs,
      retryAfterSec: allowed
        ? 0
        : Math.max(0, Math.ceil((transition.resetAtMs - nowMs) / MILLISECONDS_PER_SECOND)),
    };
  }

  async alarm(): Promise<void> {
    const nowMs = Date.now();
    const current = this.ctx.storage.sql
      .exec<
        Pick<CounterStateRow, "resetAtMs">
      >("SELECT reset_at_ms AS resetAtMs FROM rate_limit_state WHERE singleton = 1")
      .toArray()[0];

    if (!current) {
      return;
    }

    if (nowMs < current.resetAtMs) {
      await this.ctx.storage.setAlarm(current.resetAtMs);
      return;
    }

    this.ctx.storage.sql.exec(
      "DELETE FROM rate_limit_state WHERE singleton = 1 AND reset_at_ms <= ?",
      nowMs,
    );
  }
}
