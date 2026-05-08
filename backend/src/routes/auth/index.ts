import { zValidator } from "@hono/zod-validator";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import { z } from "zod";
import {
  AuthError,
  login,
  logout,
  refreshAccessToken,
  register,
  verifyEmail,
} from "../../services/auth.service.js";

const registerSchema = z.object({
  username: z
    .string()
    .min(3, "ユーザー名は3文字以上にしてください")
    .max(20, "ユーザー名は20文字以内にしてください")
    .regex(/^[a-zA-Z0-9_]+$/, "ユーザー名は英数字とアンダースコアのみ使用できます"),
  email: z.string().email("有効なメールアドレスを入力してください"),
  password: z
    .string()
    .min(8, "パスワードは8文字以上にしてください")
    .regex(/[A-Z]/, "パスワードには英大文字を1文字以上含めてください")
    .regex(/[a-z]/, "パスワードには英小文字を1文字以上含めてください")
    .regex(/[0-9]/, "パスワードには数字を1文字以上含めてください")
    .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, "パスワードには記号を1文字以上含めてください"),
});

const REFRESH_TOKEN_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7日（秒）

function getRefreshCookieOptions(secure: boolean, path: string) {
  return {
    httpOnly: true,
    secure,
    sameSite: "Strict" as const,
    path,
    maxAge: REFRESH_TOKEN_COOKIE_MAX_AGE,
  };
}

export const authRouter = new Hono();

authRouter.post(
  "/register",
  zValidator("json", registerSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const { username, email, password } = c.req.valid("json");

    try {
      await register({ username, email, password });
      return c.json({ message: "確認メールを送信しました" }, 201);
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "サーバーエラーが発生しました" }, 500);
    }
  },
);

const verifyEmailSchema = z.object({
  token: z.string().length(64, "トークンが不正です"),
});

authRouter.post(
  "/verify-email",
  zValidator("json", verifyEmailSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const { token } = c.req.valid("json");

    try {
      await verifyEmail({ token });
      return c.json({ message: "メールアドレスを確認しました" }, 200);
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "サーバーエラーが発生しました" }, 500);
    }
  },
);

const loginSchema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください"),
  password: z.string().min(1, "パスワードを入力してください"),
});

authRouter.post(
  "/login",
  zValidator("json", loginSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const { email, password } = c.req.valid("json");

    try {
      const result = await login({ email, password });
      const isProduction = process.env.NODE_ENV === "production";
      // Path を /auth ベースにすることで /auth/logout でも Cookie が届くようにする
      const authBase = c.req.path.replace(/\/[^/]+$/, "");
      setCookie(
        c,
        "refreshToken",
        result.refreshToken,
        getRefreshCookieOptions(isProduction, authBase),
      );
      // 旧 Path（authBase/refresh）に残存する Cookie も削除して 1 本に収束させる
      deleteCookie(c, "refreshToken", { path: `${authBase}/refresh` });
      return c.json({ accessToken: result.accessToken, user: result.user }, 200);
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "サーバーエラーが発生しました" }, 500);
    }
  },
);

authRouter.post("/refresh", async (c) => {
  const rawToken = getCookie(c, "refreshToken");
  // Cookie が存在しない（null/undefined）場合のみ早期 return
  // 空文字（refreshToken=）は後続の形式チェックで deleteCookie を実行する
  if (rawToken == null) {
    return c.json({ error: "リフレッシュトークンがありません" }, 401);
  }

  // randomBytes(32).toString("hex") は 64 文字の hex 文字列
  const authBase = c.req.path.replace(/\/[^/]+$/, "");
  if (!/^[0-9a-f]{64}$/.test(rawToken)) {
    deleteCookie(c, "refreshToken", { path: authBase });
    deleteCookie(c, "refreshToken", { path: `${authBase}/refresh` });
    return c.json({ error: "リフレッシュトークンの形式が不正です" }, 401);
  }

  const isProduction = process.env.NODE_ENV === "production";
  try {
    const result = await refreshAccessToken(rawToken);
    setCookie(
      c,
      "refreshToken",
      result.newRefreshToken,
      getRefreshCookieOptions(isProduction, authBase),
    );
    // 旧 Path（authBase/refresh）に残存する Cookie も削除して 1 本に収束させる
    deleteCookie(c, "refreshToken", { path: `${authBase}/refresh` });
    return c.json({ accessToken: result.accessToken }, 200);
  } catch (err) {
    // エラー時はクライアントの壊れた Cookie を削除する（両 Path）
    deleteCookie(c, "refreshToken", { path: authBase });
    deleteCookie(c, "refreshToken", { path: `${authBase}/refresh` });
    if (err instanceof AuthError) {
      return c.json({ error: err.message }, err.status);
    }
    return c.json({ error: "サーバーエラーが発生しました" }, 500);
  }
});

authRouter.post("/logout", async (c) => {
  const rawToken = getCookie(c, "refreshToken");

  const authBase = c.req.path.replace(/\/[^/]+$/, "");

  // Cookie が来ない場合（旧 Path 残存を含む）でも両 Path の削除ヘッダーを返す（冪等）
  // 空文字（refreshToken=）は形式不正として後続処理へ進む
  if (rawToken == null) {
    deleteCookie(c, "refreshToken", { path: authBase });
    deleteCookie(c, "refreshToken", { path: `${authBase}/refresh` });
    return c.body(null, 204);
  }

  // refreshToken Cookie の Path は /auth ベースに設定されているため logout でも Cookie が届く
  // 旧 Path（authBase/refresh）に残存する Cookie も同時に削除して収束させる
  deleteCookie(c, "refreshToken", { path: authBase });
  deleteCookie(c, "refreshToken", { path: `${authBase}/refresh` });

  // 形式チェック（randomBytes(32).toString("hex") は 64 文字の hex 文字列）
  if (!/^[0-9a-f]{64}$/.test(rawToken)) {
    return c.body(null, 204);
  }

  try {
    await logout(rawToken);
    return c.body(null, 204);
  } catch {
    return c.json({ error: "サーバーエラーが発生しました" }, 500);
  }
});
