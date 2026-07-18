import type { MiddlewareHandler } from "hono";
import { vi } from "vitest";
import type { AppVariables } from "../../types/index.js";
import { createUsersRouter } from "./index.js";

export const changeCurrentPassword = vi.fn();
export const deleteCurrentUser = vi.fn();
export const getCurrentUserProfile = vi.fn();
export const getCurrentUserStats = vi.fn();
export const updateCurrentUsername = vi.fn();

const authMiddleware: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  if (c.req.header("Authorization") !== "Bearer valid-token") {
    return c.json({ error: "認証が必要です" }, 401);
  }
  c.set("user", { id: "user-1", role: "USER" });
  await next();
};

export function createUsersTestRouter() {
  return createUsersRouter({
    authMiddleware,
    service: {
      changeCurrentPassword,
      deleteCurrentUser,
      getCurrentUserProfile,
      getCurrentUserStats,
      updateCurrentUsername,
    } as never,
  });
}
