import { randomUUID } from "node:crypto";

import { GameMode } from "@prisma/client";

import type { prisma as prismaClient } from "../lib/prisma.js";
import { hashPassword } from "../lib/password.js";

export const MAX_STAGING_PERFORMANCE_SESSION_COUNT = 5_000;
export const MAX_STAGING_PERFORMANCE_ANSWER_COUNT = 50_000;
const MIN_PLATFORM_REQUEST_TIMEOUT_MS = 1_000;
const MAX_PLATFORM_REQUEST_TIMEOUT_MS = 120_000;
const SYNTHETIC_PASSWORD = "StagingPerformancePass1!";
const GENERIC_FAILURE_MESSAGE = "staging account deletion性能測定に失敗しました";
const INVALID_FIXTURE_MESSAGE = "性能測定fixtureの件数が不正です";
const THRESHOLD_EXCEEDED_MESSAGE = "同期削除の性能基準を超過しました";
const CREATE_BATCH_SIZE = 500;

type PrismaClient = typeof prismaClient;

export type StagingAccountDeletionPreview = Readonly<{
  maxGameSessions: number;
  maxGameAnswers: number;
}>;

export type StagingAccountDeletionPerformanceInput = Readonly<{
  sessionCount: number;
  answerCount: number;
  platformRequestTimeoutMs: number;
}>;

export type StagingAccountDeletionPerformanceResult = StagingAccountDeletionPreview &
  Readonly<{
    fixtureGameSessions: number;
    fixtureGameAnswers: number;
    durationMs: number;
    thresholdMs: number;
    passed: true;
  }>;

export type StagingAccountDeletionPreviewClient = Readonly<{
  user: {
    findMany: (options: {
      select: {
        gameSessions: {
          select: {
            _count: {
              select: { answers: true };
            };
          };
        };
      };
    }) => Promise<Array<{ gameSessions: Array<{ _count: { answers: number } }> }>>;
  };
}>;

type SyntheticFixture = Readonly<{
  userId: string;
  currentPassword: string;
}>;

export type StagingAccountDeletionPerformanceDependencies = Readonly<{
  preview: () => Promise<StagingAccountDeletionPreview>;
  createFixture: (counts: {
    sessionCount: number;
    answerCount: number;
  }) => Promise<SyntheticFixture>;
  deleteCurrentUser: (input: { userId: string; currentPassword: string }) => Promise<void>;
  verifyFixtureDeleted: (userId: string) => Promise<void>;
  cleanupFixture: (userId: string) => Promise<void>;
  getMonotonicTime: () => number;
}>;

export async function getStagingAccountDeletionPreview(
  client: StagingAccountDeletionPreviewClient,
): Promise<StagingAccountDeletionPreview> {
  const users = await client.user.findMany({
    select: {
      gameSessions: {
        select: {
          _count: {
            select: { answers: true },
          },
        },
      },
    },
  });

  let maxGameSessions = 0;
  let maxGameAnswers = 0;
  for (const user of users) {
    maxGameSessions = Math.max(maxGameSessions, user.gameSessions.length);
    const answerCount = user.gameSessions.reduce((sum, session) => sum + session._count.answers, 0);
    maxGameAnswers = Math.max(maxGameAnswers, answerCount);
  }

  return { maxGameSessions, maxGameAnswers };
}

export function calculateAccountDeletionPerformanceThresholdMs(
  platformRequestTimeoutMs: number,
): number {
  if (
    !Number.isInteger(platformRequestTimeoutMs) ||
    platformRequestTimeoutMs < MIN_PLATFORM_REQUEST_TIMEOUT_MS ||
    platformRequestTimeoutMs > MAX_PLATFORM_REQUEST_TIMEOUT_MS
  ) {
    throw new Error(INVALID_FIXTURE_MESSAGE);
  }
  return Math.min(Math.floor(platformRequestTimeoutMs * 0.5), 5_000);
}

function validateFixtureCounts(
  input: StagingAccountDeletionPerformanceInput,
  preview: StagingAccountDeletionPreview,
): void {
  calculateAccountDeletionPerformanceThresholdMs(input.platformRequestTimeoutMs);
  if (
    !Number.isInteger(input.sessionCount) ||
    input.sessionCount < 1 ||
    input.sessionCount > MAX_STAGING_PERFORMANCE_SESSION_COUNT ||
    !Number.isInteger(input.answerCount) ||
    input.answerCount < 0 ||
    input.answerCount > MAX_STAGING_PERFORMANCE_ANSWER_COUNT ||
    input.sessionCount < preview.maxGameSessions ||
    input.answerCount < preview.maxGameAnswers
  ) {
    throw new Error(INVALID_FIXTURE_MESSAGE);
  }
}

export async function runStagingAccountDeletionPerformance(
  input: StagingAccountDeletionPerformanceInput,
  dependencies: StagingAccountDeletionPerformanceDependencies,
): Promise<StagingAccountDeletionPerformanceResult> {
  let preview: StagingAccountDeletionPreview;
  try {
    preview = await dependencies.preview();
  } catch {
    throw new Error(GENERIC_FAILURE_MESSAGE);
  }
  validateFixtureCounts(input, preview);

  let fixture: SyntheticFixture | undefined;
  let result: StagingAccountDeletionPerformanceResult | undefined;
  let failure: Error | undefined;

  try {
    fixture = await dependencies.createFixture({
      sessionCount: input.sessionCount,
      answerCount: input.answerCount,
    });
    const startedAt = dependencies.getMonotonicTime();
    await dependencies.deleteCurrentUser({
      userId: fixture.userId,
      currentPassword: fixture.currentPassword,
    });
    const durationMs = Math.max(0, dependencies.getMonotonicTime() - startedAt);
    await dependencies.verifyFixtureDeleted(fixture.userId);
    const thresholdMs = calculateAccountDeletionPerformanceThresholdMs(
      input.platformRequestTimeoutMs,
    );

    if (durationMs > thresholdMs) {
      failure = new Error(THRESHOLD_EXCEEDED_MESSAGE);
    } else {
      result = {
        ...preview,
        fixtureGameSessions: input.sessionCount,
        fixtureGameAnswers: input.answerCount,
        durationMs,
        thresholdMs,
        passed: true,
      };
    }
  } catch {
    failure = new Error(GENERIC_FAILURE_MESSAGE);
  } finally {
    if (fixture) {
      try {
        await dependencies.cleanupFixture(fixture.userId);
      } catch {
        failure = new Error(GENERIC_FAILURE_MESSAGE);
      }
    }
  }

  if (failure) {
    throw failure;
  }
  if (!result) {
    throw new Error(GENERIC_FAILURE_MESSAGE);
  }
  return result;
}

function createBatches<T>(values: readonly T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize));
  }
  return batches;
}

export async function cleanupStagingAccountDeletionFixture(
  client: PrismaClient,
  userId: string,
): Promise<void> {
  await client.auditLog.deleteMany({
    where: {
      action: "USER_ACCOUNT_DELETE",
      actorId: userId,
      targetId: userId,
    },
  });
  await client.user.deleteMany({ where: { id: userId } });
}

export async function createStagingAccountDeletionFixture(
  client: PrismaClient,
  counts: { sessionCount: number; answerCount: number },
): Promise<SyntheticFixture> {
  const element = await client.element.findFirst({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!element) {
    throw new Error(GENERIC_FAILURE_MESSAGE);
  }

  const uniquePart = randomUUID().replaceAll("-", "");
  const userId = "staging-account-deletion-performance-" + uniquePart;
  const username = "staging_perf_" + uniquePart.slice(0, 16);
  const email = "staging-perf-" + uniquePart + "@example.invalid";
  const passwordHash = await hashPassword(SYNTHETIC_PASSWORD);
  const expiresAt = new Date("2099-01-01T00:00:00.000Z");

  try {
    await client.user.create({
      data: {
        id: userId,
        username,
        email,
        passwordHash,
        emailVerified: true,
      },
    });
    await client.refreshToken.create({
      data: { tokenHash: userId + "-refresh", userId, expiresAt },
    });
    await client.emailVerification.create({
      data: { tokenHash: userId + "-verification", userId, expiresAt },
    });
    await client.passwordResetToken.create({
      data: { tokenHash: userId + "-password-reset", userId, expiresAt },
    });
    await client.weakElement.create({ data: { userId, elementId: element.id } });
    await client.gameQuestionSet.create({
      data: {
        id: userId + "-question-set",
        userId,
        mode: GameMode.SYMBOL_TO_NAME_LV1,
        questions: [{ elementId: element.id, correctElementId: element.id }],
        expiresAt,
      },
    });
    await client.userStats.create({ data: { userId } });

    const sessions = Array.from({ length: counts.sessionCount }, (_, index) => ({
      id: userId + "-session-" + index,
      userId,
      mode: GameMode.SYMBOL_TO_NAME_LV1,
      totalScore: 0,
      correctCount: 0,
      totalCount: 1,
      durationSec: 1,
    }));
    for (const batch of createBatches(sessions, CREATE_BATCH_SIZE)) {
      await client.gameSession.createMany({ data: batch });
    }

    const answers = Array.from({ length: counts.answerCount }, (_, index) => ({
      id: userId + "-answer-" + index,
      sessionId: sessions[index % sessions.length].id,
      elementId: element.id,
      isCorrect: true,
      answerTimeSec: 1,
    }));
    for (const batch of createBatches(answers, CREATE_BATCH_SIZE)) {
      await client.gameAnswer.createMany({ data: batch });
    }
  } catch {
    try {
      await cleanupStagingAccountDeletionFixture(client, userId);
    } catch {
      // 呼び出し側でgeneric errorへ正規化する。
    }
    throw new Error(GENERIC_FAILURE_MESSAGE);
  }

  return { userId, currentPassword: SYNTHETIC_PASSWORD };
}

export async function verifyStagingAccountDeletionFixtureDeleted(
  client: PrismaClient,
  userId: string,
): Promise<void> {
  const ownedRowCounts = await Promise.all([
    client.user.count({ where: { id: userId } }),
    client.refreshToken.count({ where: { userId } }),
    client.emailVerification.count({ where: { userId } }),
    client.passwordResetToken.count({ where: { userId } }),
    client.weakElement.count({ where: { userId } }),
    client.gameSession.count({ where: { userId } }),
    client.gameAnswer.count({
      where: { sessionId: { startsWith: userId + "-session-" } },
    }),
    client.gameQuestionSet.count({ where: { userId } }),
    client.userStats.count({ where: { userId } }),
  ]);
  if (ownedRowCounts.some((count) => count !== 0)) {
    throw new Error(GENERIC_FAILURE_MESSAGE);
  }
}

export async function probeStagingAccountDeletionFixtureWrites(
  client: PrismaClient,
  userId: string,
): Promise<void> {
  const nextExpiry = new Date(Date.now() + 86_400_000);
  const results = await Promise.all([
    client.user.updateMany({ where: { id: userId }, data: { lastLoginAt: new Date() } }),
    client.refreshToken.updateMany({ where: { userId }, data: { expiresAt: nextExpiry } }),
    client.emailVerification.updateMany({ where: { userId }, data: { expiresAt: nextExpiry } }),
    client.gameQuestionSet.updateMany({ where: { userId }, data: { expiresAt: nextExpiry } }),
  ]);
  if (results.some((item) => item.count !== 1)) {
    throw new Error(GENERIC_FAILURE_MESSAGE);
  }
}

export async function runStagingAccountDeletionMigrationWriteProbe(
  durationMs: number,
  dependencies: Readonly<{
    createFixture: () => Promise<SyntheticFixture>;
    probeOnce: (userId: string) => Promise<void>;
    cleanupFixture: (userId: string) => Promise<void>;
    getMonotonicTime: () => number;
    wait: (durationMs: number) => Promise<void>;
  }>,
): Promise<{ probeCount: number; writeProbeMaxDurationMs: number }> {
  if (!Number.isInteger(durationMs) || durationMs < 5_000 || durationMs > 120_000) {
    throw new Error(INVALID_FIXTURE_MESSAGE);
  }

  let fixture: SyntheticFixture | undefined;
  let failure: Error | undefined;
  let probeCount = 0;
  let writeProbeMaxDurationMs = 0;
  const probeStartedAt = dependencies.getMonotonicTime();

  try {
    fixture = await dependencies.createFixture();
    do {
      const startedAt = dependencies.getMonotonicTime();
      await dependencies.probeOnce(fixture.userId);
      writeProbeMaxDurationMs = Math.max(
        writeProbeMaxDurationMs,
        dependencies.getMonotonicTime() - startedAt,
      );
      probeCount += 1;
      await dependencies.wait(250);
    } while (dependencies.getMonotonicTime() - probeStartedAt < durationMs);
  } catch {
    failure = new Error(GENERIC_FAILURE_MESSAGE);
  } finally {
    if (fixture) {
      try {
        await dependencies.cleanupFixture(fixture.userId);
      } catch {
        failure = new Error(GENERIC_FAILURE_MESSAGE);
      }
    }
  }

  if (failure) {
    throw failure;
  }
  return { probeCount, writeProbeMaxDurationMs };
}
