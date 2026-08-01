import { vi } from "vitest";
import type { AppPrismaClient } from "../../lib/prisma-client.js";
import { createAuthMiddlewares } from "../../middleware/auth/index.js";
import type { WeakService } from "../../services/weak.service.js";
import { createWeakRouter } from "./index.js";

export const deleteWeakElement = vi.fn();
export const getWeakElements = vi.fn();

export function createWeakTestRouter(prisma: AppPrismaClient, jwtSecret: string) {
  const { authMiddleware } = createAuthMiddlewares({ prisma, jwtSecret });
  const service = { deleteWeakElement, getWeakElements } satisfies WeakService;

  return createWeakRouter({
    authMiddleware,
    service,
  });
}
