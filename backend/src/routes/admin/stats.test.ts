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
    ADMIN_USERS_DEFAULT_LIMIT: 20,
    ADMIN_USERS_MAX_LIMIT: 100,
    AdminServiceError,
    forceDeleteAdminUser: vi.fn(),
    getAdminStats: vi.fn(),
    getAdminUserDetail: vi.fn(),
    getAdminUsers: vi.fn(),
    updateAdminUserRole: vi.fn(),
    updateAdminUserStatus: vi.fn(),
  };
});

import { getAdminStats } from "../../services/admin.service.js";

const app = new Hono();
app.route("/admin", adminRouter);

describe("GET /admin/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("統計を返す", async () => {
    vi.mocked(getAdminStats).mockResolvedValue({
      users: { total: 100, active: 90, suspended: 5, deleted: 5, admins: 2, emailVerified: 80 },
      games: { totalSessions: 320, totalAnswered: 3200, averageAccuracyRate: 78 },
      learning: { totalWeakElements: 45, totalMasteredCount: 250 },
    });

    const res = await app.request("/admin/stats", {
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      users: { total: 100, active: 90, suspended: 5, deleted: 5, admins: 2, emailVerified: 80 },
      games: { totalSessions: 320, totalAnswered: 3200, averageAccuracyRate: 78 },
      learning: { totalWeakElements: 45, totalMasteredCount: 250 },
    });
  });

  it("予期しない例外は500を返す", async () => {
    vi.mocked(getAdminStats).mockRejectedValue(new Error("unexpected"));

    const res = await app.request("/admin/stats", {
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "サーバーエラーが発生しました" });
  });
});
