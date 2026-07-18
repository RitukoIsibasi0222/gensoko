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

import { AdminServiceError, getAdminUsers } from "../../services/admin.service.js";

const app = new Hono();
app.route("/admin", adminRouter);

describe("GET /admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未認証の場合は401を返す", async () => {
    const res = await app.request("/admin/users");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "認証が必要です" });
    expect(getAdminUsers).not.toHaveBeenCalled();
  });

  it("USER role の場合は403を返す", async () => {
    const res = await app.request("/admin/users", {
      headers: { Authorization: "Bearer user-token" },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "管理者権限が必要です" });
    expect(getAdminUsers).not.toHaveBeenCalled();
  });

  it("query を正規化して service に渡し、Date を ISO 文字列に変換する", async () => {
    vi.mocked(getAdminUsers).mockResolvedValue({
      users: [
        {
          id: "user-1",
          username: "taro123",
          email: "taro@example.com",
          role: "USER",
          emailVerified: true,
          isActive: true,
          lockedUntil: null,
          lastLoginAt: new Date("2026-06-20T12:00:00.000Z"),
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
          updatedAt: new Date("2026-06-20T12:00:00.000Z"),
          stats: { totalGames: 12, accuracyRate: 83, weeklyScore: 1200, allTimeScore: 5400 },
        },
      ],
      nextCursor: null,
    });

    const res = await app.request(
      "/admin/users?limit=10&q=%20taro%20&role=USER&status=active&cursor=%20cur-1%20",
      { headers: { Authorization: "Bearer admin-token" } },
    );

    expect(res.status).toBe(200);
    expect(getAdminUsers).toHaveBeenCalledWith({
      limit: 10,
      q: "taro",
      role: "USER",
      status: "active",
      cursor: "cur-1",
    });
    expect(await res.json()).toEqual({
      users: [
        {
          id: "user-1",
          username: "taro123",
          email: "taro@example.com",
          role: "USER",
          emailVerified: true,
          isActive: true,
          deletedAt: null,
          lockedUntil: null,
          lastLoginAt: "2026-06-20T12:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-06-20T12:00:00.000Z",
          stats: { totalGames: 12, accuracyRate: 83, weeklyScore: 1200, allTimeScore: 5400 },
        },
      ],
      nextCursor: null,
    });
  });

  it("deprecated status=deleted をserviceへ渡して空一覧を返す", async () => {
    vi.mocked(getAdminUsers).mockResolvedValue({ users: [], nextCursor: null });

    const res = await app.request("/admin/users?status=deleted", {
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(200);
    expect(getAdminUsers).toHaveBeenCalledWith({
      limit: 20,
      status: "deleted",
    });
    expect(await res.json()).toEqual({ users: [], nextCursor: null });
  });

  it("limit が範囲外なら400を返し service を呼ばない", async () => {
    const res = await app.request("/admin/users?limit=101", {
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("バリデーションエラー");
    expect(getAdminUsers).not.toHaveBeenCalled();
  });

  it("service の AdminServiceError は status と message を返す", async () => {
    vi.mocked(getAdminUsers).mockRejectedValue(
      new AdminServiceError(400, "カーソルが正しくありません"),
    );

    const res = await app.request("/admin/users?cursor=missing", {
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "カーソルが正しくありません" });
  });
});
