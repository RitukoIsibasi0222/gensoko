import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRouter } from "./routes/auth.js";
import type { AppVariables } from "./types/index.js";

const app = new Hono<{ Variables: AppVariables }>();

// ミドルウェア
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

// ヘルスチェック
app.get("/", (c) => {
  return c.json({ message: "Gensoko API is running 🚀", version: "1.0.0" });
});

app.get("/api/v1/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ルート登録
app.route("/api/v1/auth", authRouter);

// サーバー起動
const port = Number(process.env.PORT ?? 3000);
console.log(`Server is running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
