import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  createIpAndUserBucketResolver,
  getValidatedRateLimitJson,
  getRateLimitStore,
} from "../../middleware/rateLimit/buckets.js";
import { clearRefreshTokenCookies } from "../../lib/refresh-token-cookie.js";
import { rateLimit } from "../../middleware/rateLimit/index.js";
import { strongPasswordSchema, usernameSchema } from "../../lib/validation/auth.js";
import { UserError, type UserService } from "../../services/user.service.js";
import type { AppVariables } from "../../types/index.js";

const accountRateLimit = rateLimit({
  getStore: getRateLimitStore,
  resolveBuckets: createIpAndUserBucketResolver({
    ipPolicyId: "ACCOUNT_IP",
    userPolicyId: "ACCOUNT_USER",
  }),
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

function handleUserError(err: unknown, c: { json: (body: unknown, status: number) => Response }) {
  if (err instanceof UserError) {
    return c.json({ error: err.message }, err.status);
  }
  return c.json({ error: "サーバーエラーが発生しました" }, 500);
}

export type UsersRouterDependencies = Readonly<{
  authMiddleware: MiddlewareHandler<{ Variables: AppVariables }>;
  service: UserService;
  isProduction: boolean;
}>;

export function createUsersRouter({
  authMiddleware,
  service,
  isProduction,
}: UsersRouterDependencies) {
  const usersRouter = new Hono<{ Variables: AppVariables }>();

  usersRouter.get("/me/stats", authMiddleware, async (c) => {
    const authUser = c.get("user");
    if (!authUser) {
      return c.json({ error: "認証が必要です" }, 401);
    }

    try {
      const stats = await service.getCurrentUserStats(authUser.id);
      return c.json(stats, 200);
    } catch (err) {
      return handleUserError(err, c);
    }
  });

  usersRouter.get("/me", authMiddleware, async (c) => {
    const authUser = c.get("user");
    if (!authUser) {
      return c.json({ error: "認証が必要です" }, 401);
    }

    try {
      const user = await service.getCurrentUserProfile(authUser.id);
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
    rateLimit({
      getStore: getRateLimitStore,
      resolveBuckets: createIpAndUserBucketResolver({
        ipPolicyId: "ACCOUNT_IP",
        userPolicyId: "ACCOUNT_USER",
      }),
      when: (c) => !("username" in getValidatedRateLimitJson<z.infer<typeof updateMeSchema>>(c)),
    }),
    async (c) => {
      const authUser = c.get("user");
      if (!authUser) {
        return c.json({ error: "認証が必要です" }, 401);
      }

      const payload = c.req.valid("json");

      try {
        if ("username" in payload) {
          const updated = await service.updateCurrentUsername({
            userId: authUser.id,
            username: payload.username,
          });
          return c.json({ message: "ユーザー名を変更しました", user: updated.user }, 200);
        }

        await service.changeCurrentPassword({
          userId: authUser.id,
          currentPassword: payload.currentPassword,
          newPassword: payload.newPassword,
        });

        clearRefreshTokenCookies(c, c.req.path, isProduction);
        return c.json({ message: "パスワードを変更しました" }, 200);
      } catch (err) {
        return handleUserError(err, c);
      }
    },
  );

  usersRouter.delete(
    "/me",
    authMiddleware,
    accountRateLimit,
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
        await service.deleteCurrentUser({
          userId: authUser.id,
          currentPassword,
        });

        clearRefreshTokenCookies(c, c.req.path, isProduction);
        return c.json({ message: "アカウントを削除しました" }, 200);
      } catch (err) {
        return handleUserError(err, c);
      }
    },
  );

  return usersRouter;
}
