import type { MiddlewareHandler } from "hono";
import { vi } from "vitest";
import type { AdminService } from "../../services/admin.service.js";
import type { AppVariables } from "../../types/index.js";
import { createAdminRouter } from "./index.js";

export const forceDeleteAdminUser = vi.fn();
export const getAdminStats = vi.fn();
export const getAdminUserDetail = vi.fn();
export const getAdminUsers = vi.fn();
export const updateAdminUserRole = vi.fn();
export const updateAdminUserStatus = vi.fn();

const authMiddleware: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return c.json({ error: "認証が必要です" }, 401);
  }
  if (authHeader === "Bearer user-token") {
    c.set("user", { id: "user-1", role: "USER" });
    await next();
    return;
  }
  if (authHeader === "Bearer admin-token") {
    c.set("user", { id: "admin-1", role: "ADMIN" });
    await next();
    return;
  }
  return c.json({ error: "トークンが無効です" }, 401);
};

const adminMiddleware: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "認証が必要です" }, 401);
  }
  if (user.role !== "ADMIN") {
    return c.json({ error: "管理者権限が必要です" }, 403);
  }
  await next();
};

export function createAdminTestRouter() {
  const service = {
    forceDeleteAdminUser,
    getAdminStats,
    getAdminUserDetail,
    getAdminUsers,
    updateAdminUserRole,
    updateAdminUserStatus,
  } satisfies AdminService;

  return createAdminRouter({
    authMiddleware,
    adminMiddleware,
    service,
  });
}
