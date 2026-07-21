import { Hono } from "hono";
import { logger } from "hono/logger";
import type { AppDependencies } from "./lib/app-dependencies.js";
import { INTERNAL_SERVER_ERROR_MESSAGE } from "./lib/http-error-messages.js";
import { adminMiddleware } from "./middleware/admin/index.js";
import { createCorsMiddleware } from "./middleware/cors/index.js";
import { createIpBucketResolver, getRateLimitStore } from "./middleware/rateLimit/buckets.js";
import { rateLimit } from "./middleware/rateLimit/index.js";
import type { RateLimitDependencies } from "./middleware/rateLimit/store.js";
import { createSecurityHeadersMiddleware } from "./middleware/security/index.js";
import { createAdminRouter } from "./routes/admin/index.js";
import { createAuthRouter } from "./routes/auth/index.js";
import { createElementsRouter } from "./routes/elements/index.js";
import { createGameRouter } from "./routes/game/index.js";
import { createRankingRouter } from "./routes/ranking/index.js";
import { createUsersRouter } from "./routes/users/index.js";
import { createWeakRouter } from "./routes/weak/index.js";
import type { AppVariables } from "./types/index.js";

export type CreateAppOptions = {
  isProduction: boolean;
  frontendUrl: string;
  rateLimit: RateLimitDependencies;
  dependencies: AppDependencies;
};

const NOT_FOUND_MESSAGE = "エンドポイントが見つかりません";
const UNHANDLED_ERROR_LOG_MESSAGE = "未捕捉のサーバーエラーが発生しました";

export const createApp = ({
  isProduction,
  frontendUrl,
  rateLimit: rateLimitDependencies,
  dependencies,
}: CreateAppOptions) => {
  const app = new Hono<{ Variables: AppVariables }>();

  app.notFound((c) => c.json({ error: NOT_FOUND_MESSAGE }, 404));
  app.onError((_error, c) => {
    console.error(UNHANDLED_ERROR_LOG_MESSAGE);
    return c.json({ error: INTERNAL_SERVER_ERROR_MESSAGE }, 500);
  });

  // CORSのpreflight早期応答にも付与するため、securityはCORSより外側に置く。
  app.use("*", logger());
  app.use("*", createSecurityHeadersMiddleware({ isProduction }));
  app.use("*", createCorsMiddleware(frontendUrl));

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

  app.route(
    "/api/v1/auth",
    createAuthRouter({ service: dependencies.services.auth, isProduction }),
  );
  app.route(
    "/api/v1/admin",
    createAdminRouter({
      authMiddleware: dependencies.auth.authMiddleware,
      adminMiddleware,
      service: dependencies.services.admin,
    }),
  );
  app.route(
    "/api/v1/elements",
    createElementsRouter({
      prisma: dependencies.prisma,
      optionalAuthMiddleware: dependencies.auth.optionalAuthMiddleware,
      masteryService: dependencies.services.elementMastery,
    }),
  );
  app.route(
    "/api/v1/game",
    createGameRouter({
      authMiddleware: dependencies.auth.authMiddleware,
      service: dependencies.services.game,
    }),
  );
  app.route(
    "/api/v1/ranking",
    createRankingRouter({
      optionalAuthMiddleware: dependencies.auth.optionalAuthMiddleware,
      service: dependencies.services.ranking,
    }),
  );
  app.route(
    "/api/v1/users",
    createUsersRouter({
      authMiddleware: dependencies.auth.authMiddleware,
      service: dependencies.services.users,
    }),
  );
  app.route(
    "/api/v1/weak",
    createWeakRouter({
      authMiddleware: dependencies.auth.authMiddleware,
      service: dependencies.services.weak,
    }),
  );

  return app;
};
