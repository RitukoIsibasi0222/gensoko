import { Hono, type MiddlewareHandler } from "hono";
import type { RankingService } from "../../services/ranking.service.js";
import type { AppVariables } from "../../types/index.js";

function handleRankingError(c: { json: (body: unknown, status: number) => Response }) {
  return c.json({ error: "サーバーエラーが発生しました" }, 500);
}

export type RankingRouterDependencies = Readonly<{
  optionalAuthMiddleware: MiddlewareHandler<{ Variables: AppVariables }>;
  service: RankingService;
}>;

export function createRankingRouter({
  optionalAuthMiddleware,
  service,
}: RankingRouterDependencies) {
  const rankingRouter = new Hono<{ Variables: AppVariables }>();

  rankingRouter.get("/weekly", optionalAuthMiddleware, async (c) => {
    const user = c.get("user");

    try {
      const ranking = await service.getWeeklyRanking(user?.id);
      return c.json(ranking, 200);
    } catch {
      return handleRankingError(c);
    }
  });

  rankingRouter.get("/alltime", optionalAuthMiddleware, async (c) => {
    const user = c.get("user");

    try {
      const ranking = await service.getAllTimeRanking(user?.id);
      return c.json(ranking, 200);
    } catch {
      return handleRankingError(c);
    }
  });

  return rankingRouter;
}
