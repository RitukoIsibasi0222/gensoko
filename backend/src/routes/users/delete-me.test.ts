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

vi.mock("../../middleware/rateLimit/index.js", () => ({
  rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
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

import { deleteCurrentUser, UserError } from "../../services/user.service.js";

const app = new Hono();
app.route("/users", usersRouter);

describe("DELETE /users/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未認証の場合は401を返す", async () => {
    const res = await app.request("/users/me", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "Pass1234!" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "認証が必要です" });
  });

  it("現在のパスワード誤り時は400を返す", async () => {
    vi.mocked(deleteCurrentUser).mockRejectedValue(
      new UserError(400, "現在のパスワードが正しくありません"),
    );

    const res = await app.request("/users/me", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPassword: "WrongPass1!" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "現在のパスワードが正しくありません" });
  });

  it("アカウント削除成功時は200を返し、refreshToken削除ヘッダーを付ける", async () => {
    vi.mocked(deleteCurrentUser).mockResolvedValue();

    const res = await app.request("/users/me", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPassword: "Pass1234!" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "アカウントを削除しました" });

    const setCookies = res.headers.getSetCookie();
    expect(
      setCookies.some(
        (cookie) => cookie.includes("refreshToken=") && cookie.includes("Path=/auth"),
      ),
    ).toBe(true);
    expect(
      setCookies.some(
        (cookie) => cookie.includes("refreshToken=") && cookie.includes("Path=/auth/refresh"),
      ),
    ).toBe(true);
  });

  it("returns 400 for empty currentPassword without calling service", async () => {
    const res = await app.request("/users/me", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPassword: "" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("バリデーションエラー");
    expect(deleteCurrentUser).not.toHaveBeenCalled();
  });

  it("maps service UserError status and message", async () => {
    vi.mocked(deleteCurrentUser).mockRejectedValue(new UserError(403, "ユーザーが見つかりません"));

    const res = await app.request("/users/me", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPassword: "Pass1234!" }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "ユーザーが見つかりません" });
  });

  it("returns 500 for unexpected service errors", async () => {
    vi.mocked(deleteCurrentUser).mockRejectedValue(new Error("unexpected"));

    const res = await app.request("/users/me", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPassword: "Pass1234!" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "サーバーエラーが発生しました" });
  });
});
