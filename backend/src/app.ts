import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { getFrontendUrl } from "./lib/config.js";
import { createIpBucketResolver, getRateLimitStore } from "./middleware/rateLimit/buckets.js";
import { rateLimit } from "./middleware/rateLimit/index.js";
import type { RateLimitDependencies } from "./middleware/rateLimit/store.js";
import { createSecurityHeadersMiddleware } from "./middleware/security/index.js";
import { adminRouter } from "./routes/admin/index.js";
import { authRouter } from "./routes/auth/index.js";
import { elementsRouter } from "./routes/elements/index.js";
import { gameRouter } from "./routes/game/index.js";
import { rankingRouter } from "./routes/ranking/index.js";
import { usersRouter } from "./routes/users/index.js";
import { weakRouter } from "./routes/weak/index.js";
import type { AppVariables } from "./types/index.js";

export type CreateAppOptions = {
  isProduction: boolean;
  rateLimit: RateLimitDependencies;
};

const NOT_FOUND_MESSAGE = "エンドポイントが見つかりません";
const INTERNAL_SERVER_ERROR_MESSAGE = "サーバーエラーが発生しました";
const UNHANDLED_ERROR_LOG_MESSAGE = "未捕捉のサーバーエラーが発生しました";

export const createApp = ({ isProduction, rateLimit: rateLimitDependencies }: CreateAppOptions) => {
  const app = new Hono<{ Variables: AppVariables }>();
  const frontendUrl = getFrontendUrl({ isProduction });

  app.notFound((c) => c.json({ error: NOT_FOUND_MESSAGE }, 404));
  app.onError((_error, c) => {
    console.error(UNHANDLED_ERROR_LOG_MESSAGE);
    return c.json({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500);
  });

  // CORSのpreflight早期応答にも付与するため、securityはCORSより外側に置く。
  app.use("*", logger());
  app.use("*", createSecurityHeadersMiddleware({ isProduction }));
  app.use(
    "*",
    cors({
      origin: frontendUrl,
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );

  // store・秘密鍵・信頼済みIP取得方法はapp単位で注入し、route間で共有する。
  app.use("*", async (c, next) => {
    c.set("rateLimit", rateLimitDependencies);
    await next();
  });
  app.use(
    "/api/v1/*",
    rateLimit({
      getStore: getRateLimitStore,
      resolveBuckets: createIpBucketResolver("GENERAL_API_IP"),
      when: (c) => c.req.method !== "OPTIONS" && c.req.path !== "/api/v1/health",
    }),
  );

  app.get("/", (c) => {
    return c.json({ message: "Gensoko API is running 🚀", version: "1.0.0" });
  });

  app.get("/api/v1/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.route("/api/v1/auth", authRouter);
  app.route("/api/v1/admin", adminRouter);
  app.route("/api/v1/elements", elementsRouter);
  app.route("/api/v1/game", gameRouter);
  app.route("/api/v1/ranking", rankingRouter);
  app.route("/api/v1/users", usersRouter);
  app.route("/api/v1/weak", weakRouter);

  return app;
};
