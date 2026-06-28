import { zValidator } from "@hono/zod-validator";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import { z } from "zod";
import { strongPasswordSchema, usernameSchema } from "../../lib/validation/auth.js";
import {
  getRefreshTokenCookieBasePath,
  getRefreshTokenCookieOptions,
} from "../../lib/refresh-token-cookie.js";
import {
  AuthError,
  login,
  logout,
  refreshAccessToken,
  register,
  verifyEmail,
  forgotPassword,
  resetPassword,
} from "../../services/auth.service.js";
import { rateLimit } from "../../middleware/rateLimit/index.js";

const registerSchema = z.object({
  username: usernameSchema,
  email: z.string().email("有効なメールアドレスを入力してください"),
  password: strongPasswordSchema,
});

// 認証系エンドポイント向けレート制限（10分間で10リクエストまで）
// TRUST_PROXY=true の場合のみ x-forwarded-for / x-real-ip を信頼する（リバースプロキシ配下）
const authRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  trustProxy: process.env.TRUST_PROXY === "true",
});

export const authRouter = new Hono();

authRouter.post(
  "/register",
  authRateLimit,
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
  // randomBytes(32).toString("hex") は 64 文字の hex 文字列
  token: z.string().regex(/^[0-9a-f]{64}$/, "トークンが不正です"),
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
  authRateLimit,
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
      // Path を authBase ベースにすることで logout でも Cookie が届くようにする
      const authBase = getRefreshTokenCookieBasePath(c.req.path);
      setCookie(
        c,
        "refreshToken",
        result.refreshToken,
        getRefreshTokenCookieOptions(isProduction, authBase),
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
  const authBase = getRefreshTokenCookieBasePath(c.req.path);
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
      getRefreshTokenCookieOptions(isProduction, authBase),
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

  const authBase = getRefreshTokenCookieBasePath(c.req.path);

  // Cookie が来ない場合（旧 Path 残存を含む）でも両 Path の削除ヘッダーを返す（冪等）
  // 空文字（refreshToken=）は形式不正として後続処理へ進む
  if (rawToken == null) {
    deleteCookie(c, "refreshToken", { path: authBase });
    deleteCookie(c, "refreshToken", { path: `${authBase}/refresh` });
    return c.body(null, 204);
  }

  // refreshToken Cookie の Path は authBase ベースに設定されているため logout でも Cookie が届く
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

const forgotPasswordSchema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください"),
});

authRouter.post(
  "/forgot-password",
  authRateLimit,
  zValidator("json", forgotPasswordSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const { email } = c.req.valid("json");
    try {
      await forgotPassword({ email });
    } catch (err) {
      // 列挙攻撃対策: 内部エラー時も常に 200 を返す。エラーはサーバーログで検知する
      console.error("[forgot-password] internal error:", err);
    }
    return c.json({ message: "パスワードリセットメールを送信しました" }, 200);
  },
);

const resetPasswordSchema = z.object({
  // randomBytes(32).toString("hex") は 64 文字の hex 文字列
  token: z.string().regex(/^[0-9a-f]{64}$/, "トークンが不正です"),
  password: strongPasswordSchema,
});

authRouter.post(
  "/reset-password",
  authRateLimit,
  zValidator("json", resetPasswordSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const { token, password } = c.req.valid("json");
    try {
      await resetPassword({ token, password });
      return c.json({ message: "パスワードをリセットしました" }, 200);
    } catch (err) {
      if (err instanceof AuthError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "サーバーエラーが発生しました" }, 500);
    }
  },
);
