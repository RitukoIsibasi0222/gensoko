import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUsersTestRouter, deleteCurrentUser } from "./test-helpers.js";

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

import { UserError } from "../../services/user.service.js";
import { STRONG_PASSWORD_73_BYTES } from "../../test/password-byte-boundary-fixtures.js";

const app = new Hono();
const usersRouter = createUsersTestRouter();
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
    vi.mocked(deleteCurrentUser).mockResolvedValue(undefined);

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

  it("73バイトのcurrentPasswordは上限拒否せず完全な値をサービス層へ渡す", async () => {
    vi.mocked(deleteCurrentUser).mockResolvedValue(undefined);

    const res = await app.request("/users/me", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPassword: STRONG_PASSWORD_73_BYTES }),
    });

    expect(res.status).toBe(200);
    expect(deleteCurrentUser).toHaveBeenCalledWith({
      userId: "user-1",
      currentPassword: STRONG_PASSWORD_73_BYTES,
    });
  });

  it("currentPasswordが空の場合は400を返し、サービス層を呼び出さない", async () => {
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

  it("未定義fieldを含む場合は400を返し、サービス層を呼び出さない", async () => {
    const res = await app.request("/users/me", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPassword: "Pass1234!", userId: "another-user" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "バリデーションエラー" });
    expect(deleteCurrentUser).not.toHaveBeenCalled();
  });

  it.each([
    ["最後の管理者", "最後の管理者は退会できません"],
    ["account状態競合", "アカウントの状態が変更されています。再ログインしてください"],
    ["Serializable競合", "同時操作により退会できませんでした。再試行してください"],
  ])("%sのUserErrorは409と日本語メッセージを維持する", async (_label, message) => {
    vi.mocked(deleteCurrentUser).mockRejectedValue(new UserError(409, message));

    const res = await app.request("/users/me", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPassword: "Pass1234!" }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: message });
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("サービス層のUserErrorはステータスと日本語メッセージを返す", async () => {
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

  it("サービス層で予期しないエラーが起きた場合は500を返す", async () => {
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
    expect(JSON.stringify(body)).not.toContain("unexpected");
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});
