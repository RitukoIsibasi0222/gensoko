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

import { AdminServiceError, forceDeleteAdminUser } from "../../services/admin.service.js";

const app = new Hono();
app.route("/admin", adminRouter);

describe("DELETE /admin/users/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("service を呼び出してメッセージを返す", async () => {
    vi.mocked(forceDeleteAdminUser).mockResolvedValue({ message: "ユーザーを強制退会しました" });

    const res = await app.request("/admin/users/user-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(200);
    expect(forceDeleteAdminUser).toHaveBeenCalledWith({
      adminUserId: "admin-1",
      targetUserId: "user-1",
    });
    expect(await res.json()).toEqual({ message: "ユーザーを強制退会しました" });
  });

  it("service の409を返す", async () => {
    vi.mocked(forceDeleteAdminUser).mockRejectedValue(
      new AdminServiceError(409, "ユーザーは既に削除されています"),
    );

    const res = await app.request("/admin/users/user-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ユーザーは既に削除されています" });
  });
});
