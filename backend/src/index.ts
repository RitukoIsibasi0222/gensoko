import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createApp } from "./app.js";
import { getRateLimitConfig } from "./lib/config.js";
import { InMemoryRateLimitStore } from "./middleware/rateLimit/in-memory-store.js";
import { resolveClientIp } from "./middleware/rateLimit/key.js";
import type { RateLimitDependencies } from "./middleware/rateLimit/store.js";

const isProduction = process.env.NODE_ENV === "production";
const rateLimitConfig = getRateLimitConfig();

if (rateLimitConfig.store !== "memory") {
  throw new Error(
    "Node.jsエントリーポイントではRATE_LIMIT_STORE=memoryのみ利用できます。本番はWorkersエントリーポイントを使用してください",
  );
}

const inMemoryRateLimitStore = new InMemoryRateLimitStore();
const rateLimitDependencies: RateLimitDependencies = {
  getStore: () => inMemoryRateLimitStore,
  keySecret: rateLimitConfig.keySecret,
  resolveIp: (context) =>
    resolveClientIp({
      runtime: "node",
      socketAddress: getConnInfo(context).remote.address,
    }),
};

const app = createApp({ isProduction, rateLimit: rateLimitDependencies });

// サーバー起動
const port = Number(process.env.PORT ?? 3000);
console.log(`Server is running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
