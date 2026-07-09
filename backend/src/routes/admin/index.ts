import { zValidator } from "@hono/zod-validator";
import type { Role } from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { adminMiddleware } from "../../middleware/admin/index.js";
import { authMiddleware } from "../../middleware/auth/index.js";
import {
  ADMIN_USERS_DEFAULT_LIMIT,
  ADMIN_USERS_MAX_LIMIT,
  AdminServiceError,
  forceDeleteAdminUser,
  getAdminStats,
  getAdminUserDetail,
  getAdminUsers,
  type AdminUserDetail,
  type AdminUserListItem,
  type AdminUserSummary,
  updateAdminUserRole,
  updateAdminUserStatus,
} from "../../services/admin.service.js";
import type { AppVariables } from "../../types/index.js";

const ADMIN_USERS_LIMIT_ERROR_MESSAGE = "取得件数が正しくありません";
const ADMIN_USERS_CURSOR_ERROR_MESSAGE = "カーソルが正しくありません";
const ADMIN_USERS_QUERY_ERROR_MESSAGE = "検索キーワードが正しくありません";
const ADMIN_USERS_ID_ERROR_MESSAGE = "ユーザーIDが正しくありません";
const ADMIN_USERS_ROLE_ERROR_MESSAGE = "ロールが正しくありません";
const ADMIN_USERS_STATUS_ERROR_MESSAGE = "状態が正しくありません";

const roleValues = ["USER", "ADMIN"] as const satisfies readonly Role[];

const optionalTrimmedString = (message: string) =>
  z.preprocess((value) => {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value === "string") {
      return value.trim();
    }

    return value;
  }, z.string({ message }).optional());

const nonEmptyTrimmedString = (message: string) =>
  z.preprocess(
    (value) => {
      if (typeof value === "string") {
        return value.trim();
      }

      return value;
    },
    z.string({ message }).min(1, { message }),
  );

const adminUsersQuerySchema = z
  .object({
    limit: z.preprocess(
      (value) => {
        if (value === undefined) {
          return ADMIN_USERS_DEFAULT_LIMIT;
        }

        if (typeof value === "string") {
          const normalizedLimit = value.trim();
          if (normalizedLimit.length === 0) {
            return ADMIN_USERS_DEFAULT_LIMIT;
          }

          return Number(normalizedLimit);
        }

        return Number(value);
      },
      z
        .number({ message: ADMIN_USERS_LIMIT_ERROR_MESSAGE })
        .int({ message: ADMIN_USERS_LIMIT_ERROR_MESSAGE })
        .min(1, { message: ADMIN_USERS_LIMIT_ERROR_MESSAGE })
        .max(ADMIN_USERS_MAX_LIMIT, { message: ADMIN_USERS_LIMIT_ERROR_MESSAGE }),
    ),
    cursor: optionalTrimmedString(ADMIN_USERS_CURSOR_ERROR_MESSAGE).pipe(
      z.string().min(1, { message: ADMIN_USERS_CURSOR_ERROR_MESSAGE }).optional(),
    ),
    q: optionalTrimmedString(ADMIN_USERS_QUERY_ERROR_MESSAGE)
      .pipe(z.string().max(100, { message: ADMIN_USERS_QUERY_ERROR_MESSAGE }).optional())
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    role: z.enum(roleValues, { message: ADMIN_USERS_ROLE_ERROR_MESSAGE }).optional(),
    status: z
      .enum(["active", "suspended", "deleted"], { message: ADMIN_USERS_STATUS_ERROR_MESSAGE })
      .optional(),
  })
  .strip();

const adminUserParamSchema = z
  .object({
    id: nonEmptyTrimmedString(ADMIN_USERS_ID_ERROR_MESSAGE),
  })
  .strip();

const adminUserStatusSchema = z
  .object({
    isActive: z.boolean({ message: ADMIN_USERS_STATUS_ERROR_MESSAGE }),
  })
  .strict();

const adminUserRoleSchema = z
  .object({
    role: z.enum(roleValues, { message: ADMIN_USERS_ROLE_ERROR_MESSAGE }),
  })
  .strict();

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toPublicAdminUserSummary(user: AdminUserSummary) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    isActive: user.isActive,
    deletedAt: toIsoString(user.deletedAt),
    lockedUntil: toIsoString(user.lockedUntil),
    lastLoginAt: toIsoString(user.lastLoginAt),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function toPublicAdminUserListItem(user: AdminUserListItem) {
  return {
    ...toPublicAdminUserSummary(user),
    stats: user.stats,
  };
}

function toPublicAdminUserDetail(user: AdminUserDetail) {
  return {
    ...toPublicAdminUserSummary(user),
    loginFailCount: user.loginFailCount,
    stats: {
      ...user.stats,
      lastActiveDate: toIsoString(user.stats.lastActiveDate),
      updatedAt: toIsoString(user.stats.updatedAt),
    },
  };
}

function validationErrorResponse(
  result: { success: boolean; error?: { issues: unknown[] } },
  c: { json: (body: unknown, status: 400) => Response },
) {
  if (!result.success) {
    return c.json({ error: "バリデーションエラー", details: result.error?.issues ?? [] }, 400);
  }
}

function handleAdminServiceError(
  err: unknown,
  c: { json: (body: unknown, status: 400 | 404 | 409 | 500) => Response },
) {
  if (err instanceof AdminServiceError) {
    return c.json({ error: err.message }, err.status);
  }

  return c.json({ error: "サーバーエラーが発生しました" }, 500);
}

export const adminRouter = new Hono<{ Variables: AppVariables }>();

adminRouter.get(
  "/users",
  authMiddleware,
  adminMiddleware,
  zValidator("query", adminUsersQuerySchema, validationErrorResponse),
  async (c) => {
    const query = c.req.valid("query");

    try {
      const result = await getAdminUsers(query);
      return c.json(
        {
          users: result.users.map(toPublicAdminUserListItem),
          nextCursor: result.nextCursor,
        },
        200,
      );
    } catch (err) {
      return handleAdminServiceError(err, c);
    }
  },
);

adminRouter.get(
  "/users/:id",
  authMiddleware,
  adminMiddleware,
  zValidator("param", adminUserParamSchema, validationErrorResponse),
  async (c) => {
    const { id } = c.req.valid("param");

    try {
      const result = await getAdminUserDetail({ userId: id });
      return c.json({ user: toPublicAdminUserDetail(result.user) }, 200);
    } catch (err) {
      return handleAdminServiceError(err, c);
    }
  },
);

adminRouter.patch(
  "/users/:id/status",
  authMiddleware,
  adminMiddleware,
  zValidator("param", adminUserParamSchema, validationErrorResponse),
  zValidator("json", adminUserStatusSchema, validationErrorResponse),
  async (c) => {
    const { id } = c.req.valid("param");
    const { isActive } = c.req.valid("json");
    const authUser = c.get("user")!;

    try {
      const result = await updateAdminUserStatus({
        adminUserId: authUser.id,
        targetUserId: id,
        isActive,
      });

      return c.json(
        {
          message: result.message,
          user: toPublicAdminUserSummary(result.user),
        },
        200,
      );
    } catch (err) {
      return handleAdminServiceError(err, c);
    }
  },
);

adminRouter.patch(
  "/users/:id/role",
  authMiddleware,
  adminMiddleware,
  zValidator("param", adminUserParamSchema, validationErrorResponse),
  zValidator("json", adminUserRoleSchema, validationErrorResponse),
  async (c) => {
    const { id } = c.req.valid("param");
    const { role } = c.req.valid("json");
    const authUser = c.get("user")!;

    try {
      const result = await updateAdminUserRole({
        adminUserId: authUser.id,
        targetUserId: id,
        role,
      });

      return c.json(
        {
          message: result.message,
          user: toPublicAdminUserSummary(result.user),
        },
        200,
      );
    } catch (err) {
      return handleAdminServiceError(err, c);
    }
  },
);

adminRouter.delete(
  "/users/:id",
  authMiddleware,
  adminMiddleware,
  zValidator("param", adminUserParamSchema, validationErrorResponse),
  async (c) => {
    const { id } = c.req.valid("param");
    const authUser = c.get("user")!;

    try {
      const result = await forceDeleteAdminUser({ adminUserId: authUser.id, targetUserId: id });
      return c.json(result, 200);
    } catch (err) {
      return handleAdminServiceError(err, c);
    }
  },
);

adminRouter.get("/stats", authMiddleware, adminMiddleware, async (c) => {
  try {
    const stats = await getAdminStats();
    return c.json(stats, 200);
  } catch (err) {
    return handleAdminServiceError(err, c);
  }
});
