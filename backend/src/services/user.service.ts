import bcrypt from "bcryptjs";
import { AuditResult, type Role } from "@prisma/client";
import { normalizePassword } from "../lib/normalize.js";
import { hashPassword } from "../lib/password.js";
import {
  calculateAccuracyRate,
  normalizeCountPair,
  normalizeNonNegativeCount,
} from "../lib/stats.js";
import { isUniqueConstraintViolation } from "../lib/prisma-errors.js";
import { prisma } from "../lib/prisma.js";
import {
  SerializationRetryExhaustedError,
  runSerializableTransaction,
} from "../lib/serializable-transaction.js";
import { getUsableAdminWhere, isUsableAccount, isUsableAdmin } from "../lib/usable-admin.js";
import { getWeeklyScoreWeekStart, isSameWeeklyScoreWeek } from "../lib/weekly-score.js";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "./audit-events.js";
import { recordAuditEvent } from "./audit.service.js";

export class UserError extends Error {
  constructor(
    public readonly status: 400 | 403 | 409,
    message: string,
  ) {
    super(message);
    this.name = "UserError";
  }
}

export type CurrentUserProfile = {
  id: string;
  username: string;
  email: string;
  role: Role;
  createdAt: Date;
};

export async function getCurrentUserProfile(userId: string): Promise<CurrentUserProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new UserError(403, "ユーザーが見つかりません");
  }

  return user;
}

export async function updateCurrentUsername(input: { userId: string; username: string }): Promise<{
  user: { id: string; username: string; role: Role };
}> {
  const normalizedUsername = input.username.trim();

  const currentUser = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, username: true, role: true },
  });

  if (!currentUser) {
    throw new UserError(403, "ユーザーが見つかりません");
  }

  if (currentUser.username === normalizedUsername) {
    return {
      user: {
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role,
      },
    };
  }

  const duplicatedUser = await prisma.user.findFirst({
    where: {
      username: normalizedUsername,
      id: { not: input.userId },
    },
    select: { id: true },
  });

  if (duplicatedUser) {
    throw new UserError(409, "このユーザー名は既に使用されています");
  }

  let updatedUser: { id: string; username: string; role: Role };
  try {
    updatedUser = await prisma.user.update({
      where: { id: input.userId },
      data: { username: normalizedUsername },
      select: { id: true, username: true, role: true },
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new UserError(409, "このユーザー名は既に使用されています");
    }
    throw error;
  }

  return { user: updatedUser };
}

export async function changeCurrentPassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const normalizedCurrentPassword = normalizePassword(input.currentPassword);
  const normalizedNewPassword = normalizePassword(input.newPassword);

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true, role: true },
  });

  if (!user) {
    throw new UserError(403, "ユーザーが見つかりません");
  }

  const isCurrentPasswordValid = await bcrypt.compare(normalizedCurrentPassword, user.passwordHash);
  if (!isCurrentPasswordValid) {
    throw new UserError(400, "現在のパスワードが正しくありません");
  }

  const isNewPasswordSame = await bcrypt.compare(normalizedNewPassword, user.passwordHash);
  if (isNewPasswordSame) {
    throw new UserError(400, "新しいパスワードは現在のパスワードと異なるものにしてください");
  }

  const newPasswordHash = await hashPassword(normalizedNewPassword);

  await prisma.$transaction(async (tx) => {
    const passwordUpdate = await tx.user.updateMany({
      where: {
        id: input.userId,
        passwordHash: user.passwordHash,
      },
      data: { passwordHash: newPasswordHash },
    });
    if (passwordUpdate.count !== 1) {
      throw new UserError(409, "パスワードが既に変更されています。再ログインしてください");
    }
    await tx.refreshToken.deleteMany({ where: { userId: input.userId } });
    await recordAuditEvent(tx, {
      action: AUDIT_ACTIONS.PASSWORD_CHANGE,
      result: AuditResult.SUCCESS,
      actorId: user.id,
      actorRole: user.role,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: user.id,
      failureReason: null,
    });
  });
}

export async function deleteCurrentUser(input: {
  userId: string;
  currentPassword: string;
}): Promise<void> {
  const stateConflictMessage = "アカウントの状態が変更されています。再ログインしてください";
  const normalizedCurrentPassword = normalizePassword(input.currentPassword);

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, passwordHash: true, role: true },
  });

  if (!user) {
    throw new UserError(409, stateConflictMessage);
  }

  const isCurrentPasswordValid = await bcrypt.compare(normalizedCurrentPassword, user.passwordHash);
  if (!isCurrentPasswordValid) {
    throw new UserError(400, "現在のパスワードが正しくありません");
  }

  try {
    await runSerializableTransaction(async (tx) => {
      const currentUser = await tx.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          passwordHash: true,
          role: true,
          isActive: true,
          emailVerified: true,
          lockedUntil: true,
          deletedAt: true,
        },
      });

      const now = new Date();
      if (
        !currentUser ||
        currentUser.passwordHash !== user.passwordHash ||
        !isUsableAccount(currentUser, now)
      ) {
        throw new UserError(409, stateConflictMessage);
      }

      if (isUsableAdmin(currentUser, now)) {
        const usableAdminCount = await tx.user.count({ where: getUsableAdminWhere(now) });
        if (usableAdminCount <= 1) {
          throw new UserError(409, "最後の管理者は退会できません");
        }
      }

      const deletedUserId = currentUser.id;
      const deletedUserRole = currentUser.role;
      await tx.user.delete({ where: { id: deletedUserId } });
      await recordAuditEvent(tx, {
        action: AUDIT_ACTIONS.USER_ACCOUNT_DELETE,
        result: AuditResult.SUCCESS,
        actorId: deletedUserId,
        actorRole: deletedUserRole,
        targetType: AUDIT_TARGET_TYPES.USER,
        targetId: deletedUserId,
        failureReason: null,
      });
    });
  } catch (error) {
    if (error instanceof SerializationRetryExhaustedError) {
      throw new UserError(409, "同時操作により退会できませんでした。再試行してください");
    }
    throw error;
  }
}

const RECENT_ACCURACY_TREND_LIMIT = 10;

export type CurrentUserStatsSummary = {
  totalGames: number;
  totalCorrect: number;
  totalAnswered: number;
  averageAccuracyRate: number;
  masteredCount: number;
  currentStreak: number;
  weeklyScore: number;
  allTimeScore: number;
  lastActiveDate: Date | null;
  updatedAt: Date | null;
};

export type CurrentUserAccuracyTrendItem = {
  sessionId: string;
  playedAt: Date;
  correctCount: number;
  totalCount: number;
  accuracyRate: number;
};

export type CurrentUserStats = {
  stats: CurrentUserStatsSummary;
  recentAccuracyTrend: CurrentUserAccuracyTrendItem[];
};

function getEmptyCurrentUserStatsSummary(): CurrentUserStatsSummary {
  return {
    totalGames: 0,
    totalCorrect: 0,
    totalAnswered: 0,
    averageAccuracyRate: 0,
    masteredCount: 0,
    currentStreak: 0,
    weeklyScore: 0,
    allTimeScore: 0,
    lastActiveDate: null,
    updatedAt: null,
  };
}

export async function getCurrentUserStats(userId: string): Promise<CurrentUserStats> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new UserError(403, "ユーザーが見つかりません");
  }

  const [stats, recentSessions] = await Promise.all([
    prisma.userStats.findUnique({
      where: { userId },
      select: {
        totalGames: true,
        totalCorrect: true,
        totalAnswered: true,
        masteredCount: true,
        currentStreak: true,
        weeklyScore: true,
        weeklyScoreWeekStart: true,
        allTimeScore: true,
        lastActiveDate: true,
        updatedAt: true,
      },
    }),
    prisma.gameSession.findMany({
      where: { userId },
      orderBy: [{ playedAt: "desc" }, { id: "desc" }],
      take: RECENT_ACCURACY_TREND_LIMIT,
      select: {
        id: true,
        playedAt: true,
        correctCount: true,
        totalCount: true,
      },
    }),
  ]);

  const currentWeeklyScoreWeekStart = getWeeklyScoreWeekStart(new Date());
  const statsAnswerCounts = stats
    ? normalizeCountPair(stats.totalCorrect, stats.totalAnswered)
    : null;
  const statsSummary: CurrentUserStatsSummary = stats
    ? {
        totalGames: normalizeNonNegativeCount(stats.totalGames),
        totalCorrect: statsAnswerCounts?.correctCount ?? 0,
        totalAnswered: statsAnswerCounts?.totalCount ?? 0,
        averageAccuracyRate: calculateAccuracyRate(
          statsAnswerCounts?.correctCount ?? 0,
          statsAnswerCounts?.totalCount ?? 0,
        ),
        masteredCount: normalizeNonNegativeCount(stats.masteredCount),
        currentStreak: normalizeNonNegativeCount(stats.currentStreak),
        weeklyScore: isSameWeeklyScoreWeek(stats.weeklyScoreWeekStart, currentWeeklyScoreWeekStart)
          ? normalizeNonNegativeCount(stats.weeklyScore)
          : 0,
        allTimeScore: normalizeNonNegativeCount(stats.allTimeScore),
        lastActiveDate: stats.lastActiveDate,
        updatedAt: stats.updatedAt,
      }
    : getEmptyCurrentUserStatsSummary();

  return {
    stats: statsSummary,
    recentAccuracyTrend: [...recentSessions].reverse().map((session) => {
      const sessionCounts = normalizeCountPair(session.correctCount, session.totalCount);

      return {
        sessionId: session.id,
        playedAt: session.playedAt,
        correctCount: sessionCounts.correctCount,
        totalCount: sessionCounts.totalCount,
        accuracyRate: calculateAccuracyRate(sessionCounts.correctCount, sessionCounts.totalCount),
      };
    }),
  };
}
