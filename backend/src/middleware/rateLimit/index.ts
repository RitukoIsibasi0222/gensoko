import type { MiddlewareHandler } from "hono";

interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** store の最大エントリ数。超過時に期限切れエントリを削除し、それでも上限超なら最古エントリを削除する（デフォルト: 10000） */
  maxStoreSize?: number;
  /**
   * true の場合のみ x-forwarded-for / x-real-ip ヘッダーを IP として信頼する。
   * 信頼できるリバースプロキシ配下でのみ true にすること。デフォルト: false。
   */
  trustProxy?: boolean;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/** Node.js アダプター経由で実接続 IP を取得するための型 */
type NodeEnv = { incoming?: { socket?: { remoteAddress?: string } } };

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { windowMs, max, maxStoreSize = 10_000, trustProxy = false } = options;
  const store = new Map<string, RateLimitEntry>();

  return async (c, next) => {
    const socketIp = (c.env as NodeEnv)?.incoming?.socket?.remoteAddress ?? "unknown";

    const ip = trustProxy
      ? // 空文字 ("") は有効な IP でないため || でフォールバックする
        c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
        c.req.header("x-real-ip") ||
        socketIp
      : socketIp;

    const now = Date.now();

    // store が上限を超えたら期限切れエントリを一括削除してメモリを解放する
    if (store.size >= maxStoreSize) {
      for (const [key, val] of store) {
        if (now > val.resetAt) store.delete(key);
      }
      // 期限切れ削除後も上限を超えている場合は最も古いエントリを強制削除する
      if (store.size >= maxStoreSize) {
        const oldestKey = store.keys().next().value;
        if (oldestKey !== undefined) store.delete(oldestKey);
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
