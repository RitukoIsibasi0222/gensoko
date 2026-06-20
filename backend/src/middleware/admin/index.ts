import type { MiddlewareHandler } from "hono";
import type { AppVariables } from "../../types/index.js";

/**
 * adminMiddleware（Adminロールチェック）
 *
 * 必ず authMiddleware の後に配置すること。
 * c.get("user") が ADMIN ロールでない場合は 403 を返す。
 *
 * 使い方:
 *   app.get("/admin/users", authMiddleware, adminMiddleware, (c) => { ... });
 */
export const adminMiddleware: MiddlewareHandler<{
  Variables: AppVariables;
}> = async (c, next) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "認証が必要です" }, 401);
  }

  if (user.role !== "ADMIN") {
    return c.json({ error: "管理者権限が必要です" }, 403);
  }

  await next();
};
