import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUsersTestRouter, getCurrentUserStats } from "./test-helpers.js";

vi.mock("../../middleware/auth/index.js", () => ({
  authMiddleware: vi.fn(
    async (
      c: {
        req: { header: (name: string) => string | undefined };
        set: (key: string, value: unknown) => void;
        json: (body: unknown, status: number) => Response;
      },
      next: () => Promise<void>,
    ) => {
      const authHeader = c.req.header("Authorization");
      if (authHeader !== "Bearer valid-token") {
        return c.json({ error: "認証が必要です" }, 401);
      }
      c.set("user", { id: "user-1", role: "USER" });
      await next();
    },
  ),
}));

vi.mock("../../services/user.service.js", () => {
  class UserError extends Error {
    constructor(
      public readonly status: 400 | 403 | 409,
      message: string,
    ) {
      super(message);
      this.name = "UserError";
    }
  }

  return {
    UserError,
    getCurrentUserProfile: vi.fn(),
    getCurrentUserStats: vi.fn(),
    updateCurrentUsername: vi.fn(),
    changeCurrentPassword: vi.fn(),
    deleteCurrentUser: vi.fn(),
  };
});

import { UserError } from "../../services/user.service.js";

const app = new Hono();
const usersRouter = createUsersTestRouter();
app.route("/users", usersRouter);

describe("GET /users/me/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未認証の場合は401を返す", async () => {
    const res = await app.request("/users/me/stats", { method: "GET" });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "認証が必要です" });
  });

  it("認証済みの場合は200で統計情報を返す", async () => {
    vi.mocked(getCurrentUserStats).mockResolvedValue({
      stats: {
        totalGames: 12,
        totalCorrect: 91,
        totalAnswered: 120,
        averageAccuracyRate: 76,
        masteredCount: 18,
        currentStreak: 5,
        weeklyScore: 2400,
        allTimeScore: 9200,
        lastActiveDate: new Date("2026-06-20T00:00:00.000Z"),
        updatedAt: new Date("2026-06-20T12:35:00.000Z"),
      },
      recentAccuracyTrend: [
        {
          sessionId: "session-1",
          playedAt: new Date("2026-06-20T12:35:00.000Z"),
          correctCount: 8,
          totalCount: 10,
          accuracyRate: 80,
        },
      ],
    });

    const res = await app.request("/users/me/stats", {
      method: "GET",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      stats: {
        totalGames: 12,
        totalCorrect: 91,
        totalAnswered: 120,
        averageAccuracyRate: 76,
        masteredCount: 18,
        currentStreak: 5,
        weeklyScore: 2400,
        allTimeScore: 9200,
        lastActiveDate: "2026-06-20T00:00:00.000Z",
        updatedAt: "2026-06-20T12:35:00.000Z",
      },
      recentAccuracyTrend: [
        {
          sessionId: "session-1",
          playedAt: "2026-06-20T12:35:00.000Z",
          correctCount: 8,
          totalCount: 10,
          accuracyRate: 80,
        },
      ],
    });
    expect(getCurrentUserStats).toHaveBeenCalledWith("user-1");
  });

  it("サービス層のUserErrorはステータスと日本語メッセージを返す", async () => {
    vi.mocked(getCurrentUserStats).mockRejectedValue(
      new UserError(403, "ユーザーが見つかりません"),
    );

    const res = await app.request("/users/me/stats", {
      method: "GET",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "ユーザーが見つかりません" });
  });

  it("サービス層で予期しないエラーが起きた場合は500を返す", async () => {
    vi.mocked(getCurrentUserStats).mockRejectedValue(new Error("unexpected"));

    const res = await app.request("/users/me/stats", {
      method: "GET",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "サーバーエラーが発生しました" });
  });
});
