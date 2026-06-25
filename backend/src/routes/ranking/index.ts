import { Hono } from "hono";
import { optionalAuthMiddleware } from "../../middleware/auth/index.js";
import { getAllTimeRanking, getWeeklyRanking } from "../../services/ranking.service.js";
import type { AppVariables } from "../../types/index.js";

function handleRankingError(c: { json: (body: unknown, status: number) => Response }) {
  return c.json({ error: "サーバーエラーが発生しました" }, 500);
}

export const rankingRouter = new Hono<{ Variables: AppVariables }>();

rankingRouter.get("/weekly", optionalAuthMiddleware, async (c) => {
  const user = c.get("user");

  try {
    const ranking = await getWeeklyRanking(user?.id);
    return c.json(ranking, 200);
  } catch {
    return handleRankingError(c);
  }
});

rankingRouter.get("/alltime", optionalAuthMiddleware, async (c) => {
  const user = c.get("user");

  try {
    const ranking = await getAllTimeRanking(user?.id);
    return c.json(ranking, 200);
  } catch {
    return handleRankingError(c);
  }
});
