import { zValidator } from "@hono/zod-validator";
import { deleteCookie } from "hono/cookie";
import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth/index.js";
import { rateLimit } from "../../middleware/rateLimit/index.js";
import { strongPasswordSchema, usernameSchema } from "../../lib/validation/auth.js";
import {
  UserError,
  changeCurrentPassword,
  deleteCurrentUser,
  getCurrentUserProfile,
  updateCurrentUsername,
} from "../../services/user.service.js";
import type { AppVariables } from "../../types/index.js";

const REFRESH_COOKIE_PATHS = ["/api/v1/auth", "/api/v1/auth/refresh"] as const;

const authRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  trustProxy: process.env.TRUST_PROXY === "true",
});

const updateUsernameSchema = z
  .object({
    username: usernameSchema,
  })
  .strict();

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "現在のパスワードを入力してください"),
    newPassword: strongPasswordSchema,
  })
  .strict();

const updateMeSchema = z.union([updateUsernameSchema, changePasswordSchema]);

const deleteMeSchema = z
  .object({
    currentPassword: z.string().min(1, "現在のパスワードを入力してください"),
  })
  .strict();

function clearRefreshTokenCookies(c: Parameters<typeof deleteCookie>[0]) {
  for (const path of REFRESH_COOKIE_PATHS) {
    deleteCookie(c, "refreshToken", { path });
  }
}

function handleUserError(err: unknown, c: { json: (body: unknown, status: number) => Response }) {
  if (err instanceof UserError) {
    return c.json({ error: err.message }, err.status);
  }
  return c.json({ error: "サーバーエラーが発生しました" }, 500);
}

export const usersRouter = new Hono<{ Variables: AppVariables }>();

usersRouter.get("/me", authMiddleware, async (c) => {
  const authUser = c.get("user");
  if (!authUser) {
    return c.json({ error: "認証が必要です" }, 401);
  }

  try {
    const user = await getCurrentUserProfile(authUser.id);
    return c.json({ user }, 200);
  } catch (err) {
    return handleUserError(err, c);
  }
});

usersRouter.patch(
  "/me",
  authMiddleware,
  zValidator("json", updateMeSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const authUser = c.get("user");
    if (!authUser) {
      return c.json({ error: "認証が必要です" }, 401);
    }

    const payload = c.req.valid("json");

    try {
      if ("username" in payload) {
        const updated = await updateCurrentUsername({
          userId: authUser.id,
          username: payload.username,
        });
        return c.json({ message: "ユーザー名を変更しました", user: updated.user }, 200);
      }

      const rateLimitResult = await authRateLimit(c, async () => {});
      if (rateLimitResult instanceof Response) {
        return rateLimitResult;
      }

      await changeCurrentPassword({
        userId: authUser.id,
        currentPassword: payload.currentPassword,
        newPassword: payload.newPassword,
      });

      clearRefreshTokenCookies(c);
      return c.json({ message: "パスワードを変更しました" }, 200);
    } catch (err) {
      return handleUserError(err, c);
    }
  },
);

usersRouter.delete(
  "/me",
  authMiddleware,
  authRateLimit,
  zValidator("json", deleteMeSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const authUser = c.get("user");
    if (!authUser) {
      return c.json({ error: "認証が必要です" }, 401);
    }

    const { currentPassword } = c.req.valid("json");

    try {
      await deleteCurrentUser({
        userId: authUser.id,
        currentPassword,
      });

      clearRefreshTokenCookies(c);
      return c.json({ message: "アカウントを削除しました" }, 200);
    } catch (err) {
      return handleUserError(err, c);
    }
  },
);
