import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppVariables } from "../../types/index.js";

vi.mock("../../middleware/auth/index.js", () => ({
  optionalAuthMiddleware: vi.fn(
    async (
      c: {
        req: { header: (name: string) => string | undefined };
        set: (key: string, value: unknown) => void;
        json: (body: unknown, status: number) => Response;
      },
      next: () => Promise<void>,
    ) => {
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
    },
  ),
}));

vi.mock("../../services/ranking.service.js", () => ({
  getWeeklyRanking: vi.fn(),
  getAllTimeRanking: vi.fn(),
}));

import { createRankingTestRouter, getAllTimeRanking, getWeeklyRanking } from "./test-helpers.js";

const app = new Hono<{ Variables: AppVariables }>();
const rankingRouter = createRankingTestRouter();
app.route("/ranking", rankingRouter);

describe("rankingRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /ranking/weekly は未ログインでも200で週間ランキングを返す", async () => {
    vi.mocked(getWeeklyRanking).mockResolvedValue({
      ranking: [
        { rank: 1, username: "taro", weeklyScore: 15000, totalGames: 30, accuracyRate: 86 },
      ],
      myRank: null,
    });

    const res = await app.request("/ranking/weekly", { method: "GET" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ranking: [
        { rank: 1, username: "taro", weeklyScore: 15000, totalGames: 30, accuracyRate: 86 },
      ],
      myRank: null,
    });
    expect(getWeeklyRanking).toHaveBeenCalledWith(undefined);
  });

  it("GET /ranking/alltime はログイン済みユーザーIDをserviceに渡す", async () => {
    vi.mocked(getAllTimeRanking).mockResolvedValue({
      ranking: [
        { rank: 1, username: "hanako", allTimeScore: 92000, totalGames: 180, accuracyRate: 91 },
      ],
      myRank: 42,
    });

    const res = await app.request("/ranking/alltime", {
      method: "GET",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ranking: [
        { rank: 1, username: "hanako", allTimeScore: 92000, totalGames: 180, accuracyRate: 91 },
      ],
      myRank: 42,
    });
    expect(getAllTimeRanking).toHaveBeenCalledWith("user-1");
  });

  it("Authorization が不正な場合は401を返す", async () => {
    const res = await app.request("/ranking/weekly", {
      method: "GET",
      headers: { Authorization: "Bearer invalid-token" },
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "トークンが無効です" });
    expect(getWeeklyRanking).not.toHaveBeenCalled();
  });

  it("serviceで予期しないエラーが起きた場合は500を返す", async () => {
    vi.mocked(getWeeklyRanking).mockRejectedValue(new Error("unexpected"));

    const res = await app.request("/ranking/weekly", { method: "GET" });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "サーバーエラーが発生しました" });
  });
});
