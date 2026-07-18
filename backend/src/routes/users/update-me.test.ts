import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  changeCurrentPassword,
  createUsersTestRouter,
  updateCurrentUsername,
} from "./test-helpers.js";

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
import { PASSWORD_TOO_LONG_MESSAGE } from "../../lib/password.js";
import {
  STRONG_PASSWORD_72_BYTES,
  STRONG_PASSWORD_73_BYTES,
} from "../../test/password-byte-boundary-fixtures.js";

const app = new Hono();
const usersRouter = createUsersTestRouter();
app.route("/users", usersRouter);

describe("PATCH /users/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未認証の場合は401を返し、サービス層を呼び出さない", async () => {
    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "new_name_123" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "認証が必要です" });
    expect(updateCurrentUsername).not.toHaveBeenCalled();
    expect(changeCurrentPassword).not.toHaveBeenCalled();
  });

  it("ユーザー名変更成功時は200を返す", async () => {
    vi.mocked(updateCurrentUsername).mockResolvedValue({
      user: { id: "user-1", username: "new_name_123", role: "USER" },
    });

    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "new_name_123" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      message: "ユーザー名を変更しました",
      user: { id: "user-1", username: "new_name_123", role: "USER" },
    });
  });

  it("ユーザー名重複時は409を返す", async () => {
    vi.mocked(updateCurrentUsername).mockRejectedValue(
      new UserError(409, "このユーザー名は既に使用されています"),
    );

    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "duplicated_name" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "このユーザー名は既に使用されています" });
  });

  it("ユーザー名形式が不正な場合は400を返す", async () => {
    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "ab" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("バリデーションエラー");
  });

  it("パスワード変更成功時は200を返し、refreshToken削除ヘッダーを付ける", async () => {
    vi.mocked(changeCurrentPassword).mockResolvedValue(undefined);

    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        currentPassword: "OldPass1!",
        newPassword: STRONG_PASSWORD_72_BYTES,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "パスワードを変更しました" });

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

  it("73バイトのnewPasswordは400を返しサービス層を呼び出さない", async () => {
    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        currentPassword: "OldPass1!",
        newPassword: STRONG_PASSWORD_73_BYTES,
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "バリデーションエラー",
      details: [
        expect.objectContaining({
          message: PASSWORD_TOO_LONG_MESSAGE,
          path: ["newPassword"],
        }),
      ],
    });
    expect(changeCurrentPassword).not.toHaveBeenCalled();
  });

  it("73バイトのcurrentPasswordは上限拒否せず完全な値をサービス層へ渡す", async () => {
    vi.mocked(changeCurrentPassword).mockResolvedValue(undefined);

    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        currentPassword: STRONG_PASSWORD_73_BYTES,
        newPassword: "NewPass1!",
      }),
    });

    expect(res.status).toBe(200);
    expect(changeCurrentPassword).toHaveBeenCalledWith({
      userId: "user-1",
      currentPassword: STRONG_PASSWORD_73_BYTES,
      newPassword: "NewPass1!",
    });
  });

  it("現在のパスワード誤り時は400を返す", async () => {
    vi.mocked(changeCurrentPassword).mockRejectedValue(
      new UserError(400, "現在のパスワードが正しくありません"),
    );

    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPassword: "WrongPass1!", newPassword: "NewPass1!" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "現在のパスワードが正しくありません" });
  });

  it("新旧パスワード同一時は400を返す", async () => {
    vi.mocked(changeCurrentPassword).mockRejectedValue(
      new UserError(400, "新しいパスワードは現在のパスワードと異なるものにしてください"),
    );

    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPassword: "SamePass1!", newPassword: "SamePass1!" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "新しいパスワードは現在のパスワードと異なるものにしてください" });
  });

  it("弱い新パスワードは400を返す", async () => {
    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ currentPassword: "OldPass1!", newPassword: "weakpass" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("バリデーションエラー");
  });

  it("usernameとpassword変更payloadを混在させると400を返す", async () => {
    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "new_name_123",
        currentPassword: "OldPass1!",
        newPassword: "NewPass1!",
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("バリデーションエラー");
  });

  it("サービス層のUserErrorはステータスと日本語メッセージを返す", async () => {
    vi.mocked(updateCurrentUsername).mockRejectedValue(
      new UserError(403, "ユーザーが見つかりません"),
    );

    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "new_name_123" }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "ユーザーが見つかりません" });
  });

  it("サービス層で予期しないエラーが起きた場合は500を返す", async () => {
    vi.mocked(updateCurrentUsername).mockRejectedValue(new Error("unexpected"));

    const res = await app.request("/users/me", {
      method: "PATCH",
      headers: {
        Authorization: "Bearer valid-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "new_name_123" }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "サーバーエラーが発生しました" });
  });
});
