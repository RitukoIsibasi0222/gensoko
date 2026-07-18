import type { MiddlewareHandler } from "hono";
import { vi } from "vitest";
import type { AppVariables } from "../../types/index.js";
import { createRankingRouter } from "./index.js";

export const getAllTimeRanking = vi.fn();
export const getWeeklyRanking = vi.fn();

const optionalAuthMiddleware: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    await next();
    return;
  }
  if (authHeader !== "Bearer valid-token") {
    return c.json({ error: "トークンが無効です" }, 401);
  }
  c.set("user", { id: "user-1", role: "USER" });
  await next();
};

export function createRankingTestRouter() {
  return createRankingRouter({
    optionalAuthMiddleware,
    service: { getAllTimeRanking, getWeeklyRanking } as never,
  });
}
