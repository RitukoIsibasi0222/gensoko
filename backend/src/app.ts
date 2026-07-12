import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
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
};

export const createApp = ({ isProduction }: CreateAppOptions) => {
  const app = new Hono<{ Variables: AppVariables }>();

  // CORSのpreflight早期応答にも付与するため、securityはCORSより外側に置く。
  app.use("*", logger());
  app.use("*", createSecurityHeadersMiddleware({ isProduction }));
  app.use(
    "*",
    cors({
      origin: process.env.FRONTEND_URL ?? "http://localhost:5174",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
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
