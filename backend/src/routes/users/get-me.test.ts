import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usersRouter } from "./index.js";

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
    updateCurrentUsername: vi.fn(),
    changeCurrentPassword: vi.fn(),
    deleteCurrentUser: vi.fn(),
  };
});

import { getCurrentUserProfile, UserError } from "../../services/user.service.js";

const app = new Hono();
app.route("/users", usersRouter);

describe("GET /users/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未認証の場合は401を返す", async () => {
    const res = await app.request("/users/me", { method: "GET" });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "認証が必要です" });
  });

  it("認証済みの場合は200でプロフィールを返す", async () => {
    vi.mocked(getCurrentUserProfile).mockResolvedValue({
      id: "user-1",
      username: "taro123",
      email: "taro@example.com",
      role: "USER",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    const res = await app.request("/users/me", {
      method: "GET",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      user: {
        id: "user-1",
        username: "taro123",
        email: "taro@example.com",
        role: "USER",
        createdAt: "2026-05-01T00:00:00.000Z",
      },
    });
    expect(getCurrentUserProfile).toHaveBeenCalledWith("user-1");
  });

  it("サービス層のUserErrorはステータスと日本語メッセージを返す", async () => {
    vi.mocked(getCurrentUserProfile).mockRejectedValue(
      new UserError(403, "ユーザーが見つかりません"),
    );

    const res = await app.request("/users/me", {
      method: "GET",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "ユーザーが見つかりません" });
  });

  it("サービス層で予期しないエラーが起きた場合は500を返す", async () => {
    vi.mocked(getCurrentUserProfile).mockRejectedValue(new Error("unexpected"));

    const res = await app.request("/users/me", {
      method: "GET",
      headers: { Authorization: "Bearer valid-token" },
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "サーバーエラーが発生しました" });
  });
});
