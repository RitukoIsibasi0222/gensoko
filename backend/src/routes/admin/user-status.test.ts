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

import { AdminServiceError, updateAdminUserStatus } from "../../services/admin.service.js";

const app = new Hono();
app.route("/admin", adminRouter);

describe("PATCH /admin/users/:id/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isActive を service に渡して結果を返す", async () => {
    vi.mocked(updateAdminUserStatus).mockResolvedValue({
      message: "アカウントを停止しました",
      user: {
        id: "user-1",
        username: "taro123",
        email: "taro@example.com",
        role: "USER",
        emailVerified: true,
        isActive: false,
        deletedAt: null,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-06-20T12:00:00.000Z"),
      },
    });

    const res = await app.request("/admin/users/user-1/status", {
      method: "PATCH",
      headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });

    expect(res.status).toBe(200);
    expect(updateAdminUserStatus).toHaveBeenCalledWith({
      adminUserId: "admin-1",
      targetUserId: "user-1",
      isActive: false,
    });
    const body = await res.json();
    expect(body.user.updatedAt).toBe("2026-06-20T12:00:00.000Z");
  });

  it("body が不正なら400を返し service を呼ばない", async () => {
    const res = await app.request("/admin/users/user-1/status", {
      method: "PATCH",
      headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: "false" }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("バリデーションエラー");
    expect(updateAdminUserStatus).not.toHaveBeenCalled();
  });

  it("service の409を返す", async () => {
    vi.mocked(updateAdminUserStatus).mockRejectedValue(
      new AdminServiceError(409, "最後の管理者は変更できません"),
    );

    const res = await app.request("/admin/users/admin-2/status", {
      method: "PATCH",
      headers: { Authorization: "Bearer admin-token", "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "最後の管理者は変更できません" });
  });
});
