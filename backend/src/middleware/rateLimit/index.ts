import type { MiddlewareHandler } from "hono";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** store の最大エントリ数。超過時に期限切れエントリを削除する（デフォルト: 10000） */
  maxStoreSize?: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { windowMs, max, maxStoreSize = 10_000 } = options;
  const store = new Map<string, RateLimitEntry>();

  return async (c, next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ??
      c.req.header("x-real-ip") ??
      "unknown";

    const now = Date.now();

    // store が上限を超えたら期限切れエントリを一括削除してメモリを解放する
    if (store.size >= maxStoreSize) {
      for (const [key, val] of store) {
        if (now > val.resetAt) store.delete(key);
      }
    }

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
