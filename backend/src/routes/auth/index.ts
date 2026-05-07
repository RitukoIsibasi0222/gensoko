import { zValidator } from "@hono/zod-validator";
import { getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import { z } from "zod";
import {
  AuthError,
  login,
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
      setCookie(c, "refreshToken", result.refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "Strict",
        path: "/auth/refresh",
        maxAge: 7 * 24 * 60 * 60, // 7日（秒）
      });
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
  if (!rawToken) {
    return c.json({ error: "リフレッシュトークンがありません" }, 401);
  }

  try {
    const result = await refreshAccessToken(rawToken);
    const isProduction = process.env.NODE_ENV === "production";
    setCookie(c, "refreshToken", result.newRefreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "Strict",
      path: "/auth/refresh",
      maxAge: 7 * 24 * 60 * 60, // 7日（秒）
    });
    return c.json({ accessToken: result.accessToken }, 200);
  } catch (err) {
    if (err instanceof AuthError) {
      return c.json({ error: err.message }, err.status);
    }
    return c.json({ error: "サーバーエラーが発生しました" }, 500);
  }
});
