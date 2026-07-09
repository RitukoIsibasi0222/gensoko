import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminRouter } from "./index.js";

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
      if (!authHeader) {
        return c.json({ error: "認証が必要です" }, 401);
      }
      if (authHeader === "Bearer user-token") {
        c.set("user", { id: "user-1", role: "USER" });
        await next();
        return;
      }
      if (authHeader === "Bearer admin-token") {
        c.set("user", { id: "admin-1", role: "ADMIN" });
        await next();
        return;
      }
      return c.json({ error: "トークンが無効です" }, 401);
    },
  ),
}));

vi.mock("../../middleware/admin/index.js", () => ({
  adminMiddleware: vi.fn(
    async (
      c: {
        get: (key: "user") => { id: string; role: "USER" | "ADMIN" } | undefined;
        json: (body: unknown, status: number) => Response;
      },
      next: () => Promise<void>,
    ) => {
      const user = c.get("user");
      if (!user) {
        return c.json({ error: "認証が必要です" }, 401);
      }
      if (user.role !== "ADMIN") {
        return c.json({ error: "管理者権限が必要です" }, 403);
      }
      await next();
    },
  ),
}));

vi.mock("../../services/admin.service.js", () => {
  class AdminServiceError extends Error {
    constructor(
      public readonly status: 400 | 404 | 409,
      message: string,
    ) {
      super(message);
      this.name = "AdminServiceError";
    }
  }

  return {
    AdminServiceError,
    forceDeleteAdminUser: vi.fn(),
    getAdminStats: vi.fn(),
    getAdminUserDetail: vi.fn(),
    getAdminUsers: vi.fn(),
    updateAdminUserRole: vi.fn(),
    updateAdminUserStatus: vi.fn(),
  };
});

import { AdminServiceError, getAdminUserDetail } from "../../services/admin.service.js";

const app = new Hono();
app.route("/admin", adminRouter);

describe("GET /admin/users/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("詳細を返し、Date を ISO 文字列に変換する", async () => {
    vi.mocked(getAdminUserDetail).mockResolvedValue({
      user: {
        id: "user-1",
        username: "taro123",
        email: "taro@example.com",
        role: "USER",
        emailVerified: true,
        isActive: true,
        deletedAt: null,
        loginFailCount: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-06-20T12:00:00.000Z"),
        stats: {
          totalGames: 12,
          totalCorrect: 50,
          totalAnswered: 60,
          accuracyRate: 83,
          masteredCount: 18,
          currentStreak: 4,
          weeklyScore: 1200,
          allTimeScore: 5400,
          lastActiveDate: new Date("2026-06-20T12:00:00.000Z"),
          updatedAt: new Date("2026-06-20T12:00:00.000Z"),
        },
      },
    });

    const res = await app.request("/admin/users/user-1", {
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(200);
    expect(getAdminUserDetail).toHaveBeenCalledWith({ userId: "user-1" });
    const body = await res.json();
    expect(body.user.createdAt).toBe("2026-05-01T00:00:00.000Z");
    expect(body.user.stats.lastActiveDate).toBe("2026-06-20T12:00:00.000Z");
    expect(body.user).not.toHaveProperty("passwordHash");
  });

  it("service の404を返す", async () => {
    vi.mocked(getAdminUserDetail).mockRejectedValue(
      new AdminServiceError(404, "ユーザーが見つかりません"),
    );

    const res = await app.request("/admin/users/missing", {
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "ユーザーが見つかりません" });
  });
});
