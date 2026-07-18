import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createApp } from "./app.js";
import { createAppDependencies } from "./lib/app-dependencies.js";
import { getFrontendUrl, getRateLimitConfig } from "./lib/config.js";
import { nodeMailSender } from "./lib/mail.js";
import { prisma } from "./lib/prisma.js";
import { InMemoryRateLimitStore } from "./middleware/rateLimit/in-memory-store.js";
import { resolveClientIp } from "./middleware/rateLimit/key.js";
import type { RateLimitDependencies } from "./middleware/rateLimit/store.js";

const isProduction = process.env.NODE_ENV === "production";
const frontendUrl = getFrontendUrl({ isProduction });
const rateLimitConfig = getRateLimitConfig();

function requireEnvironmentValue(name: "JWT_SECRET" | "MAIL_FROM"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name}の設定が必要です`);
  }
  return value;
}

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

const dependencies = createAppDependencies({
  prisma,
  mailSender: nodeMailSender,
  jwtSecret: requireEnvironmentValue("JWT_SECRET"),
  frontendUrl,
  mailFrom: requireEnvironmentValue("MAIL_FROM"),
});
const app = createApp({
  isProduction,
  frontendUrl,
  rateLimit: rateLimitDependencies,
  dependencies,
});

// サーバー起動
const port = Number(process.env.PORT ?? 3000);
console.log(`Server is running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
