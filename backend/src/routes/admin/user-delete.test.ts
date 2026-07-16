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

  it("未認証の場合は401を返しserviceを呼び出さない", async () => {
    const res = await app.request("/admin/users/user-1", { method: "DELETE" });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "認証が必要です" });
    expect(forceDeleteAdminUser).not.toHaveBeenCalled();
  });

  it("一般ユーザーの場合は403を返しserviceを呼び出さない", async () => {
    const res = await app.request("/admin/users/user-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer user-token" },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "管理者権限が必要です" });
    expect(forceDeleteAdminUser).not.toHaveBeenCalled();
  });

  it("trim後のtarget IDが空なら400を返しserviceを呼び出さない", async () => {
    const res = await app.request("/admin/users/%20", {
      method: "DELETE",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "バリデーションエラー" });
    expect(forceDeleteAdminUser).not.toHaveBeenCalled();
  });

  it("物理削除済みtargetの404を日本語メッセージのまま返す", async () => {
    vi.mocked(forceDeleteAdminUser).mockRejectedValue(
      new AdminServiceError(404, "ユーザーが見つかりません"),
    );

    const res = await app.request("/admin/users/user-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "ユーザーが見つかりません" });
  });

  it.each([
    ["自分自身", "自分自身には実行できません"],
    ["最後の管理者", "最後の管理者は変更できません"],
    ["actor状態競合", "管理者の状態が変更されています。再ログインしてください"],
    ["Serializable競合", "同時操作により処理できませんでした。再試行してください"],
  ])("%sのservice errorは409を維持する", async (_label, message) => {
    vi.mocked(forceDeleteAdminUser).mockRejectedValue(new AdminServiceError(409, message));

    const res = await app.request("/admin/users/user-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: message });
  });

  it("予期しないerrorは内部messageを含まない500へ変換する", async () => {
    vi.mocked(forceDeleteAdminUser).mockRejectedValue(new Error("database connection details"));

    const res = await app.request("/admin/users/user-1", {
      method: "DELETE",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "サーバーエラーが発生しました" });
    expect(JSON.stringify(body)).not.toContain("database connection details");
  });
});
