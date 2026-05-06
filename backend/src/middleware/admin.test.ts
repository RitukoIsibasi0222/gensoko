/**
 * middleware/admin.test.ts
 *
 * adminMiddleware のユニットテスト
 * - authMiddleware の後に配置する前提（c.get("user") がセット済み）
 * - Prisma モック不要（DB アクセスなし）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { AppVariables } from "../types/index.js";
import { adminMiddleware } from "./admin.js";

// -----------------------------------------------------------------
// テスト用 Hono アプリを作成するヘルパー
// -----------------------------------------------------------------

/**
 * authMiddleware の代わりに user を手動でセットするダミーミドルウェア
 */
const createApp = (userPayload: AppVariables["user"] | undefined) => {
  const app = new Hono<{ Variables: AppVariables }>();

  // ダミー認証: user を任意の値でセット（authMiddleware のシミュレーション）
  app.use("*", async (c, next) => {
    if (userPayload !== undefined) {
      c.set("user", userPayload);
    }
    await next();
  });

  // admin 保護エンドポイント
  app.get("/admin/test", adminMiddleware, (c) => {
    return c.json({ ok: true });
  });

  return app;
};

// =================================================================
// adminMiddleware のテスト
// =================================================================
describe("adminMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JWT_SECRET", "test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------
  // ケース1: user が未セット（authMiddleware を経由していない）→ 401
  // -------------------------------------------------------------------
  it("user が未セットの場合は 401 を返す", async () => {
    const app = createApp(undefined);
    const res = await app.request("/admin/test");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  // -------------------------------------------------------------------
  // ケース2: role = USER → 403
  // -------------------------------------------------------------------
  it("USER ロールの場合は 403 を返す", async () => {
    const app = createApp({ id: "user-1", role: "USER" });
    const res = await app.request("/admin/test");

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
  });

  // -------------------------------------------------------------------
  // ケース3: role = ADMIN → 通過して 200
  // -------------------------------------------------------------------
  it("ADMIN ロールの場合は通過して 200 を返す", async () => {
    const app = createApp({ id: "admin-1", role: "ADMIN" });
    const res = await app.request("/admin/test");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
