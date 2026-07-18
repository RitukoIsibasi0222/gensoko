import { vi } from "vitest";
import type { AppPrismaClient } from "../../lib/prisma-client.js";
import { createAuthMiddlewares } from "../../middleware/auth/index.js";
import { createWeakRouter } from "./index.js";

export const deleteWeakElement = vi.fn();
export const getWeakElements = vi.fn();

export function createWeakTestRouter(prisma: AppPrismaClient, jwtSecret: string) {
  const { authMiddleware } = createAuthMiddlewares({ prisma, jwtSecret });
  return createWeakRouter({
    authMiddleware,
    service: { deleteWeakElement, getWeakElements } as never,
  });
}
