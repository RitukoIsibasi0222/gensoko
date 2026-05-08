import type { MiddlewareHandler } from "hono";

interface RateLimitOptions {
  windowMs: number;
  max: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { windowMs, max } = options;
  const store = new Map<string, RateLimitEntry>();

  return async (c, next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ??
      c.req.header("x-real-ip") ??
      "unknown";

    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now > entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      return c.json({ error: "リクエストが多すぎます。しばらく待ってから再試行してください" }, 429);
    }

    return next();
  };
}
