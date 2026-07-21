import { prisma } from "../lib/prisma.js";
import { runSerializableTransaction } from "../lib/serializable-transaction.js";

const CLEANUP_PREVIEWED_EVENT = "account_data_deletion.legacy_cleanup.previewed";
const CLEANUP_BATCH_COMPLETED_EVENT = "account_data_deletion.legacy_cleanup.batch_completed";
const CLEANUP_COMPLETED_EVENT = "account_data_deletion.legacy_cleanup.completed";
const CLEANUP_FAILED_EVENT = "account_data_deletion.legacy_cleanup.failed";
const CLEANUP_FAILED_MESSAGE = "既存退会済みユーザーの完全削除に失敗しました";
const EMPTY_DELETE_ONLY_USER_IDS_MESSAGE = "削除対象User IDを1件以上指定してください";
const LEGACY_USER_WHERE = { deletedAt: { not: null } } as const;
const LEGACY_CHILD_WHERE = { user: LEGACY_USER_WHERE } as const;
const LEGACY_ANSWER_WHERE = { session: { user: LEGACY_USER_WHERE } } as const;

export type DeleteLegacySoftDeletedUsersMode = "dry-run" | "execute";

export type DeleteLegacySoftDeletedUsersResult = Readonly<{
  mode: DeleteLegacySoftDeletedUsersMode;
  matchedUsers: number;
  deletedUsers: number;
  processedBatches: number;
  remainingUsers: number;
}>;

export type LegacySoftDeletedUserTableCounts = Readonly<{
  users: number;
  refreshTokens: number;
  emailVerifications: number;
  passwordResetTokens: number;
  weakElements: number;
  gameSessions: number;
  gameAnswers: number;
  gameQuestionSets: number;
  userStats: number;
}>;

export type DeleteLegacySoftDeletedUsersInput = Readonly<{
  mode: DeleteLegacySoftDeletedUsersMode;
  batchSize: number;
  deleteOnlyUserIds?: readonly string[];
}>;

async function inspectLegacySoftDeletedUserTableCounts(): Promise<LegacySoftDeletedUserTableCounts> {
  const [
    users,
    refreshTokens,
    emailVerifications,
    passwordResetTokens,
    weakElements,
    gameSessions,
    gameAnswers,
    gameQuestionSets,
    userStats,
  ] = await Promise.all([
    prisma.user.count({ where: LEGACY_USER_WHERE }),
    prisma.refreshToken.count({ where: LEGACY_CHILD_WHERE }),
    prisma.emailVerification.count({ where: LEGACY_CHILD_WHERE }),
    prisma.passwordResetToken.count({ where: LEGACY_CHILD_WHERE }),
    prisma.weakElement.count({ where: LEGACY_CHILD_WHERE }),
    prisma.gameSession.count({ where: LEGACY_CHILD_WHERE }),
    prisma.gameAnswer.count({ where: LEGACY_ANSWER_WHERE }),
    prisma.gameQuestionSet.count({ where: LEGACY_CHILD_WHERE }),
    prisma.userStats.count({ where: LEGACY_CHILD_WHERE }),
  ]);

  return {
    users,
    refreshTokens,
    emailVerifications,
    passwordResetTokens,
    weakElements,
    gameSessions,
    gameAnswers,
    gameQuestionSets,
    userStats,
  };
}

function createResult(
  mode: DeleteLegacySoftDeletedUsersMode,
  matchedUsers: number,
  deletedUsers: number,
  processedBatches: number,
  remainingUsers: number,
): DeleteLegacySoftDeletedUsersResult {
  return {
    mode,
    matchedUsers,
    deletedUsers,
    processedBatches,
    remainingUsers,
  };
}

/**
 * 旧実装でsoft delete済みになったUserを集計またはbatch物理削除する。
 * batch sizeはgetAccountDataDeletionConfigで検証済みの値を受け取る。
 */
export async function deleteLegacySoftDeletedUsers({
  mode,
  batchSize,
  deleteOnlyUserIds,
}: DeleteLegacySoftDeletedUsersInput): Promise<DeleteLegacySoftDeletedUsersResult> {
  if (deleteOnlyUserIds !== undefined && deleteOnlyUserIds.length === 0) {
    throw new TypeError(EMPTY_DELETE_ONLY_USER_IDS_MESSAGE);
  }

  const startedAt = performance.now();
  let tableCounts: LegacySoftDeletedUserTableCounts | undefined;
  let deletedUsers = 0;
  let processedBatches = 0;

  const getDurationMs = (): number => Math.max(0, performance.now() - startedAt);

  try {
    tableCounts = await inspectLegacySoftDeletedUserTableCounts();
    const matchedUsers = tableCounts.users;
    const requiredBatches = Math.ceil(matchedUsers / batchSize);

    if (mode === "dry-run") {
      const result = createResult(mode, matchedUsers, 0, 0, matchedUsers);
      console.info({
        event: CLEANUP_PREVIEWED_EVENT,
        tableCounts,
        batchSize,
        requiredBatches,
        ...result,
        durationMs: getDurationMs(),
        completion: "completed",
      });
      return result;
    }

    if (matchedUsers > 0) {
      const deletionWhere =
        deleteOnlyUserIds === undefined
          ? LEGACY_USER_WHERE
          : {
              ...LEGACY_USER_WHERE,
              id: { in: [...deleteOnlyUserIds] },
            };
      while (true) {
        const rows = await prisma.user.findMany({
          where: deletionWhere,
          orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
          take: batchSize,
          select: { id: true },
        });

        if (rows.length === 0) {
          break;
        }

        const batchIds = rows.map((row) => row.id);
        const deleteResult = await runSerializableTransaction(
          async (tx) =>
            await tx.user.deleteMany({
              where: {
                id: { in: batchIds },
                deletedAt: { not: null },
              },
            }),
        );
        deletedUsers += deleteResult.count;
        processedBatches += 1;

        console.info({
          event: CLEANUP_BATCH_COMPLETED_EVENT,
          mode,
          batchSize,
          batchNumber: processedBatches,
          batchDeletedUsers: deleteResult.count,
          deletedUsers,
          durationMs: getDurationMs(),
          completion: "in_progress",
        });

        if (rows.length < batchSize) {
          break;
        }
      }
    }

    const remainingUsers = await prisma.user.count({
      where: LEGACY_USER_WHERE,
    });
    const result = createResult(mode, matchedUsers, deletedUsers, processedBatches, remainingUsers);
    console.info({
      event: CLEANUP_COMPLETED_EVENT,
      tableCounts,
      batchSize,
      requiredBatches,
      ...result,
      durationMs: getDurationMs(),
      completion: "completed",
    });
    return result;
  } catch (error) {
    console.error({
      event: CLEANUP_FAILED_EVENT,
      mode,
      tableCounts,
      batchSize,
      matchedUsers: tableCounts?.users ?? 0,
      deletedUsers,
      processedBatches,
      durationMs: getDurationMs(),
      completion: "failed",
    });
    throw new Error(CLEANUP_FAILED_MESSAGE, { cause: error });
  }
}
