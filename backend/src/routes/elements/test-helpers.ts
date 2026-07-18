import type { AppPrismaClient } from "../../lib/prisma-client.js";
import { createAuthMiddlewares } from "../../middleware/auth/index.js";
import { createElementMasteryService } from "../../services/element-mastery.service.js";
import { createElementsRouter } from "./index.js";

export function createElementsTestRouter(prisma: AppPrismaClient, jwtSecret: string) {
  const { optionalAuthMiddleware } = createAuthMiddlewares({ prisma, jwtSecret });
  return createElementsRouter({
    prisma,
    optionalAuthMiddleware,
    masteryService: createElementMasteryService(prisma),
  });
}
