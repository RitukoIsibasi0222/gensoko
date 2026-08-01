import { vi } from "vitest";
import type { AppPrismaClient } from "../../lib/prisma-client.js";
import { createAuthMiddlewares } from "../../middleware/auth/index.js";
import type { GameService } from "../../services/game.service.js";
import { createGameRouter } from "./index.js";

export const createGameQuestionSet = vi.fn();
export const getGameSessionHistory = vi.fn();
export const getGameSessionResult = vi.fn();
export const submitGameSession = vi.fn();

export function createGameTestRouter(prisma: AppPrismaClient, jwtSecret: string) {
  const { authMiddleware } = createAuthMiddlewares({ prisma, jwtSecret });
  const service = {
    createGameQuestionSet,
    getGameSessionHistory,
    getGameSessionResult,
    submitGameSession,
  } satisfies GameService;

  return createGameRouter({
    authMiddleware,
    service,
  });
}
