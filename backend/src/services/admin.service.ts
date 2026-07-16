import { AuditResult, Prisma, type Role } from "@prisma/client";
import { calculateAccuracyRate, normalizeNonNegativeCount } from "../lib/stats.js";
import { prisma } from "../lib/prisma.js";
import {
  SerializationRetryExhaustedError,
  runSerializableTransaction,
} from "../lib/serializable-transaction.js";
import { getUsableAdminWhere, isUsableAdmin } from "../lib/usable-admin.js";
import {
  AUDIT_ACTIONS,
  AUDIT_FAILURE_REASONS,
  AUDIT_TARGET_TYPES,
  type AdminAuditAction,
  type AdminAuditFailureReason,
} from "./audit-events.js";
import { recordAuditEvent, recordAuditEventBestEffort } from "./audit.service.js";

export class AdminServiceError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
    public readonly auditFailureReason?: AdminAuditFailureReason,
    public readonly auditTargetId: string | null = null,
  ) {
    super(message);
    this.name = "AdminServiceError";
  }
}

export type AdminUserStatusFilter = "active" | "suspended" | "deleted";

export type AdminUserListQuery = {
  limit?: number;
  cursor?: string;
  q?: string;
  role?: Role;
  status?: AdminUserStatusFilter;
};

export type AdminUserSummary = {
  id: string;
  username: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  isActive: boolean;
  deletedAt: Date | null;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminUserListItem = AdminUserSummary & {
  stats: {
    totalGames: number;
    accuracyRate: number;
    weeklyScore: number;
    allTimeScore: number;
  };
};

export type AdminUserDetail = AdminUserSummary & {
  loginFailCount: number;
  stats: {
    totalGames: number;
    totalCorrect: number;
    totalAnswered: number;
    accuracyRate: number;
    masteredCount: number;
    currentStreak: number;
    weeklyScore: number;
    allTimeScore: number;
    lastActiveDate: Date | null;
    updatedAt: Date | null;
  };
};

export type AdminStats = {
  users: {
    total: number;
    active: number;
    suspended: number;
    deleted: number;
    admins: number;
    emailVerified: number;
  };
  games: {
    totalSessions: number;
    totalAnswered: number;
    averageAccuracyRate: number;
  };
  learning: {
    totalWeakElements: number;
    totalMasteredCount: number;
  };
};

export const ADMIN_USERS_DEFAULT_LIMIT = 20;
export const ADMIN_USERS_MAX_LIMIT = 100;
const ADMIN_MUTATION_CONFLICT_MESSAGE = "同時操作により処理できませんでした。再試行してください";

type AdminAuditDescriptor = {
  action: AdminAuditAction;
  adminUserId: string;
  targetUserId: string;
};

const adminUserSummarySelect = {
  id: true,
  username: true,
  email: true,
  role: true,
  emailVerified: true,
  isActive: true,
  deletedAt: true,
  lockedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const adminUserListSelect = {
  ...adminUserSummarySelect,
  stats: {
    select: {
      totalGames: true,
      totalCorrect: true,
      totalAnswered: true,
      weeklyScore: true,
      allTimeScore: true,
    },
  },
} as const;

const adminUserDetailSelect = {
  ...adminUserSummarySelect,
  loginFailCount: true,
  stats: {
    select: {
      totalGames: true,
      totalCorrect: true,
      totalAnswered: true,
      masteredCount: true,
      currentStreak: true,
      weeklyScore: true,
      allTimeScore: true,
      lastActiveDate: true,
      updatedAt: true,
    },
  },
} as const;

type AdminUserListRow = Prisma.UserGetPayload<{ select: typeof adminUserListSelect }>;
type AdminUserDetailRow = Prisma.UserGetPayload<{ select: typeof adminUserDetailSelect }>;
type AdminUserSummaryRow = Prisma.UserGetPayload<{ select: typeof adminUserSummarySelect }>;

type TokenCleanupClient = {
  refreshToken: { deleteMany: (args: { where: { userId: string } }) => Promise<unknown> };
  passwordResetToken: { deleteMany: (args: { where: { userId: string } }) => Promise<unknown> };
  emailVerification: { deleteMany: (args: { where: { userId: string } }) => Promise<unknown> };
};

function normalizeId(id: string): string {
  return id.trim();
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return ADMIN_USERS_DEFAULT_LIMIT;
  }

  if (!Number.isFinite(limit)) {
    return ADMIN_USERS_DEFAULT_LIMIT;
  }

  const integerLimit = Math.floor(limit);

  return Math.min(Math.max(integerLimit, 1), ADMIN_USERS_MAX_LIMIT);
}

function buildAdminUsersWhere(input: {
  q?: string;
  role?: Role;
  status?: AdminUserStatusFilter;
  cursor?: { id: string; createdAt: Date };
}): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};
  const andConditions: Prisma.UserWhereInput[] = [];
  const normalizedQuery = input.q?.trim();

  if (input.role) {
    where.role = input.role;
  }

  if (input.status === "active") {
    where.isActive = true;
    where.deletedAt = null;
  }

  if (input.status === "suspended") {
    where.isActive = false;
    where.deletedAt = null;
  }

  if (input.status === "deleted") {
    where.deletedAt = { not: null };
  }

  if (normalizedQuery) {
    where.OR = [
      { username: { contains: normalizedQuery } },
      { email: { contains: normalizedQuery } },
    ];
  }

  if (input.cursor) {
    andConditions.push({
      OR: [
        { createdAt: { lt: input.cursor.createdAt } },
        { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
      ],
    });
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  return where;
}

function toAdminUserSummary(user: AdminUserSummaryRow): AdminUserSummary {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    isActive: user.isActive,
    deletedAt: user.deletedAt,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function toAdminUserListItem(user: AdminUserListRow): AdminUserListItem {
  const totalCorrect = user.stats?.totalCorrect ?? 0;
  const totalAnswered = user.stats?.totalAnswered ?? 0;

  return {
    ...toAdminUserSummary(user),
    stats: {
      totalGames: normalizeNonNegativeCount(user.stats?.totalGames ?? 0),
      accuracyRate: calculateAccuracyRate(totalCorrect, totalAnswered),
      weeklyScore: normalizeNonNegativeCount(user.stats?.weeklyScore ?? 0),
      allTimeScore: normalizeNonNegativeCount(user.stats?.allTimeScore ?? 0),
    },
  };
}

function toAdminUserDetail(user: AdminUserDetailRow): AdminUserDetail {
  const totalCorrect = user.stats?.totalCorrect ?? 0;
  const totalAnswered = user.stats?.totalAnswered ?? 0;

  return {
    ...toAdminUserSummary(user),
    loginFailCount: normalizeNonNegativeCount(user.loginFailCount),
    stats: {
      totalGames: normalizeNonNegativeCount(user.stats?.totalGames ?? 0),
      totalCorrect: normalizeNonNegativeCount(totalCorrect),
      totalAnswered: normalizeNonNegativeCount(totalAnswered),
      accuracyRate: calculateAccuracyRate(totalCorrect, totalAnswered),
      masteredCount: normalizeNonNegativeCount(user.stats?.masteredCount ?? 0),
      currentStreak: normalizeNonNegativeCount(user.stats?.currentStreak ?? 0),
      weeklyScore: normalizeNonNegativeCount(user.stats?.weeklyScore ?? 0),
      allTimeScore: normalizeNonNegativeCount(user.stats?.allTimeScore ?? 0),
      lastActiveDate: user.stats?.lastActiveDate ?? null,
      updatedAt: user.stats?.updatedAt ?? null,
    },
  };
}

async function deleteUserTokens(tx: TokenCleanupClient, userId: string): Promise<void> {
  await Promise.all([
    tx.refreshToken.deleteMany({ where: { userId } }),
    tx.passwordResetToken.deleteMany({ where: { userId } }),
    tx.emailVerification.deleteMany({ where: { userId } }),
  ]);
}

// 最後の管理者保護は count -> update なので、write skew を DB 側で検出する。
async function runAdminMutationTransaction<T>(
  audit: AdminAuditDescriptor,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await runSerializableTransaction(async (tx) => {
      const result = await callback(tx);
      await recordAuditEvent(tx, {
        action: audit.action,
        result: AuditResult.SUCCESS,
        actorId: audit.adminUserId,
        actorRole: "ADMIN",
        targetType: AUDIT_TARGET_TYPES.USER,
        targetId: audit.targetUserId,
        failureReason: null,
      });
      return result;
    });
  } catch (error) {
    if (error instanceof SerializationRetryExhaustedError) {
      throw new AdminServiceError(
        409,
        ADMIN_MUTATION_CONFLICT_MESSAGE,
        AUDIT_FAILURE_REASONS.SERIALIZATION_CONFLICT,
      );
    }
    throw error;
  }
}

async function runAuditedAdminMutation<T>(
  audit: AdminAuditDescriptor,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AdminServiceError && error.auditFailureReason) {
      await recordAuditEventBestEffort({
        action: audit.action,
        result: AuditResult.FAILURE,
        actorId: audit.adminUserId,
        actorRole: "ADMIN",
        targetType: error.auditTargetId === null ? null : AUDIT_TARGET_TYPES.USER,
        targetId: error.auditTargetId,
        failureReason: error.auditFailureReason,
      });
    }

    throw error;
  }
}

export async function getAdminUsers(input: AdminUserListQuery = {}): Promise<{
  users: AdminUserListItem[];
  nextCursor: string | null;
}> {
  const limit = normalizeLimit(input.limit);
  const normalizedCursor = input.cursor?.trim();
  const normalizedQuery = input.q?.trim();

  let cursorUser: { id: string; createdAt: Date } | undefined;
  if (normalizedCursor !== undefined) {
    if (!normalizedCursor) {
      throw new AdminServiceError(400, "カーソルが正しくありません");
    }

    const foundCursor = await prisma.user.findUnique({
      where: { id: normalizedCursor },
      select: { id: true, createdAt: true },
    });

    if (!foundCursor) {
      throw new AdminServiceError(400, "カーソルが正しくありません");
    }

    cursorUser = foundCursor;
  }

  const rows = await prisma.user.findMany({
    where: buildAdminUsersWhere({
      q: normalizedQuery,
      role: input.role,
      status: input.status,
      cursor: cursorUser,
    }),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: adminUserListSelect,
  });

  const visibleRows = rows.slice(0, limit);

  return {
    users: visibleRows.map(toAdminUserListItem),
    nextCursor: rows.length > limit ? (visibleRows[visibleRows.length - 1]?.id ?? null) : null,
  };
}

export async function getAdminUserDetail(input: {
  userId: string;
}): Promise<{ user: AdminUserDetail }> {
  const userId = normalizeId(input.userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: adminUserDetailSelect,
  });

  if (!user) {
    throw new AdminServiceError(404, "ユーザーが見つかりません");
  }

  return { user: toAdminUserDetail(user) };
}

export async function updateAdminUserStatus(input: {
  adminUserId: string;
  targetUserId: string;
  isActive: boolean;
}): Promise<{ message: string; user: AdminUserSummary }> {
  const adminUserId = normalizeId(input.adminUserId);
  const targetUserId = normalizeId(input.targetUserId);
  const audit: AdminAuditDescriptor = {
    action: input.isActive ? AUDIT_ACTIONS.ADMIN_USER_REACTIVATE : AUDIT_ACTIONS.ADMIN_USER_SUSPEND,
    adminUserId,
    targetUserId,
  };

  return await runAuditedAdminMutation(audit, async () => {
    if (adminUserId === targetUserId) {
      throw new AdminServiceError(
        409,
        "自分自身には実行できません",
        AUDIT_FAILURE_REASONS.SELF_OPERATION_DENIED,
        adminUserId,
      );
    }

    return await runAdminMutationTransaction(audit, async (tx) => {
      const targetUser = await tx.user.findUnique({
        where: { id: targetUserId },
        select: adminUserSummarySelect,
      });

      if (!targetUser) {
        throw new AdminServiceError(
          404,
          "ユーザーが見つかりません",
          AUDIT_FAILURE_REASONS.TARGET_NOT_FOUND,
        );
      }

      if (targetUser.deletedAt) {
        throw new AdminServiceError(
          409,
          "削除済みユーザーは変更できません",
          AUDIT_FAILURE_REASONS.TARGET_STATE_CONFLICT,
          targetUser.id,
        );
      }

      const now = new Date();
      if (!input.isActive && isUsableAdmin(targetUser, now)) {
        const usableAdminCount = await tx.user.count({ where: getUsableAdminWhere(now) });
        if (usableAdminCount <= 1) {
          throw new AdminServiceError(
            409,
            "最後の管理者は変更できません",
            AUDIT_FAILURE_REASONS.LAST_ADMIN_PROTECTED,
            targetUser.id,
          );
        }
      }

      const updatedUser = await tx.user.update({
        where: { id: targetUserId },
        data: { isActive: input.isActive, lockedUntil: null },
        select: adminUserSummarySelect,
      });

      if (!input.isActive) {
        await deleteUserTokens(tx, targetUserId);
      }

      return {
        message: input.isActive ? "アカウント停止を解除しました" : "アカウントを停止しました",
        user: toAdminUserSummary(updatedUser),
      };
    });
  });
}

export async function updateAdminUserRole(input: {
  adminUserId: string;
  targetUserId: string;
  role: Role;
}): Promise<{ message: string; user: AdminUserSummary }> {
  const adminUserId = normalizeId(input.adminUserId);
  const targetUserId = normalizeId(input.targetUserId);
  const audit: AdminAuditDescriptor = {
    action: AUDIT_ACTIONS.ADMIN_USER_ROLE_CHANGE,
    adminUserId,
    targetUserId,
  };

  return await runAuditedAdminMutation(audit, async () => {
    if (adminUserId === targetUserId) {
      throw new AdminServiceError(
        409,
        "自分自身には実行できません",
        AUDIT_FAILURE_REASONS.SELF_OPERATION_DENIED,
        adminUserId,
      );
    }

    return await runAdminMutationTransaction(audit, async (tx) => {
      const targetUser = await tx.user.findUnique({
        where: { id: targetUserId },
        select: adminUserSummarySelect,
      });

      if (!targetUser) {
        throw new AdminServiceError(
          404,
          "ユーザーが見つかりません",
          AUDIT_FAILURE_REASONS.TARGET_NOT_FOUND,
        );
      }

      if (!targetUser.isActive || targetUser.deletedAt) {
        throw new AdminServiceError(
          409,
          "停止中または削除済みのユーザーは変更できません",
          AUDIT_FAILURE_REASONS.TARGET_STATE_CONFLICT,
          targetUser.id,
        );
      }

      const now = new Date();
      if (input.role === "USER" && isUsableAdmin(targetUser, now)) {
        const usableAdminCount = await tx.user.count({ where: getUsableAdminWhere(now) });
        if (usableAdminCount <= 1) {
          throw new AdminServiceError(
            409,
            "最後の管理者は変更できません",
            AUDIT_FAILURE_REASONS.LAST_ADMIN_PROTECTED,
            targetUser.id,
          );
        }
      }

      if (input.role === "ADMIN" && !targetUser.emailVerified) {
        throw new AdminServiceError(
          409,
          "メール認証済みで有効なユーザーのみ管理者にできます",
          AUDIT_FAILURE_REASONS.TARGET_STATE_CONFLICT,
          targetUser.id,
        );
      }

      const updatedUser = await tx.user.update({
        where: { id: targetUserId },
        data: { role: input.role },
        select: adminUserSummarySelect,
      });

      return {
        message: "ロールを変更しました",
        user: toAdminUserSummary(updatedUser),
      };
    });
  });
}

export async function forceDeleteAdminUser(input: {
  adminUserId: string;
  targetUserId: string;
}): Promise<{ message: string }> {
  const adminUserId = normalizeId(input.adminUserId);
  const targetUserId = normalizeId(input.targetUserId);
  const audit: AdminAuditDescriptor = {
    action: AUDIT_ACTIONS.ADMIN_USER_FORCE_DELETE,
    adminUserId,
    targetUserId,
  };

  return await runAuditedAdminMutation(audit, async () => {
    if (adminUserId === targetUserId) {
      throw new AdminServiceError(
        409,
        "自分自身には実行できません",
        AUDIT_FAILURE_REASONS.SELF_OPERATION_DENIED,
        adminUserId,
      );
    }

    return await runAdminMutationTransaction(audit, async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: adminUserId },
        select: {
          id: true,
          role: true,
          isActive: true,
          emailVerified: true,
          lockedUntil: true,
          deletedAt: true,
        },
      });
      const now = new Date();
      if (!actor || !isUsableAdmin(actor, now)) {
        throw new AdminServiceError(
          409,
          "管理者の状態が変更されています。再ログインしてください",
          AUDIT_FAILURE_REASONS.ACTOR_STATE_CONFLICT,
        );
      }

      const targetUser = await tx.user.findUnique({
        where: { id: targetUserId },
        select: adminUserSummarySelect,
      });

      if (!targetUser) {
        throw new AdminServiceError(
          404,
          "ユーザーが見つかりません",
          AUDIT_FAILURE_REASONS.TARGET_NOT_FOUND,
        );
      }

      if (targetUser.deletedAt) {
        throw new AdminServiceError(
          409,
          "ユーザーは既に削除されています",
          AUDIT_FAILURE_REASONS.TARGET_STATE_CONFLICT,
          targetUser.id,
        );
      }

      if (isUsableAdmin(targetUser, now)) {
        const usableAdminCount = await tx.user.count({ where: getUsableAdminWhere(now) });
        if (usableAdminCount <= 1) {
          throw new AdminServiceError(
            409,
            "最後の管理者は変更できません",
            AUDIT_FAILURE_REASONS.LAST_ADMIN_PROTECTED,
            targetUser.id,
          );
        }
      }

      await tx.user.delete({ where: { id: targetUserId } });

      return { message: "ユーザーを強制退会しました" };
    });
  });
}

export async function getAdminStats(): Promise<AdminStats> {
  const [
    totalUsers,
    activeUsers,
    suspendedUsers,
    deletedUsers,
    adminUsers,
    emailVerifiedUsers,
    totalSessions,
    totalWeakElements,
    statsAggregate,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true, deletedAt: null } }),
    prisma.user.count({ where: { isActive: false, deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: { not: null } } }),
    prisma.user.count({ where: { role: "ADMIN", deletedAt: null } }),
    prisma.user.count({ where: { emailVerified: true, deletedAt: null } }),
    prisma.gameSession.count(),
    prisma.weakElement.count(),
    prisma.userStats.aggregate({
      _sum: { totalAnswered: true, totalCorrect: true, masteredCount: true },
    }),
  ]);

  const totalAnswered = normalizeNonNegativeCount(statsAggregate._sum.totalAnswered ?? 0);
  const totalCorrect = normalizeNonNegativeCount(statsAggregate._sum.totalCorrect ?? 0);

  return {
    users: {
      total: normalizeNonNegativeCount(totalUsers),
      active: normalizeNonNegativeCount(activeUsers),
      suspended: normalizeNonNegativeCount(suspendedUsers),
      deleted: normalizeNonNegativeCount(deletedUsers),
      admins: normalizeNonNegativeCount(adminUsers),
      emailVerified: normalizeNonNegativeCount(emailVerifiedUsers),
    },
    games: {
      totalSessions: normalizeNonNegativeCount(totalSessions),
      totalAnswered,
      averageAccuracyRate: calculateAccuracyRate(totalCorrect, totalAnswered),
    },
    learning: {
      totalWeakElements: normalizeNonNegativeCount(totalWeakElements),
      totalMasteredCount: normalizeNonNegativeCount(statsAggregate._sum.masteredCount ?? 0),
    },
  };
}
