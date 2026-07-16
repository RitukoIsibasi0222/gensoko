import { describe, expect, it, vi } from "vitest";

import {
  MAX_STAGING_PERFORMANCE_ANSWER_COUNT,
  MAX_STAGING_PERFORMANCE_SESSION_COUNT,
  calculateAccountDeletionPerformanceThresholdMs,
  cleanupStagingAccountDeletionFixture,
  getStagingAccountDeletionPreview,
  runStagingAccountDeletionMigrationWriteProbe,
  runStagingAccountDeletionPerformance,
  verifyStagingAccountDeletionFixtureDeleted,
} from "./stagingAccountDeletionPerformance.js";

function createDependencies(
  overrides: Partial<Parameters<typeof runStagingAccountDeletionPerformance>[1]> = {},
): Parameters<typeof runStagingAccountDeletionPerformance>[1] {
  return {
    preview: vi.fn().mockResolvedValue({
      maxGameSessions: 10,
      maxGameAnswers: 100,
    }),
    createFixture: vi.fn().mockResolvedValue({
      userId: "synthetic-user",
      currentPassword: "SyntheticPass1!",
    }),
    deleteCurrentUser: vi.fn().mockResolvedValue(undefined),
    verifyFixtureDeleted: vi.fn().mockResolvedValue(undefined),
    cleanupFixture: vi.fn().mockResolvedValue(undefined),
    getMonotonicTime: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(350),
    ...overrides,
  };
}

describe("getStagingAccountDeletionPreview", () => {
  it("Userの識別情報をselectせず最大GameSession/GameAnswer件数だけを返す", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        gameSessions: [{ _count: { answers: 2 } }, { _count: { answers: 3 } }],
      },
      {
        gameSessions: [{ _count: { answers: 9 } }],
      },
    ]);

    await expect(
      getStagingAccountDeletionPreview({
        user: { findMany },
      }),
    ).resolves.toEqual({
      maxGameSessions: 2,
      maxGameAnswers: 9,
    });
    expect(findMany).toHaveBeenCalledWith({
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
  });

  it("既存Userが0件なら最大件数0を返す", async () => {
    await expect(
      getStagingAccountDeletionPreview({
        user: { findMany: vi.fn().mockResolvedValue([]) },
      }),
    ).resolves.toEqual({
      maxGameSessions: 0,
      maxGameAnswers: 0,
    });
  });
});

describe("runStagingAccountDeletionMigrationWriteProbe", () => {
  it("synthetic fixtureだけへwriteし、最大待ち時間を返してcleanupする", async () => {
    const cleanupFixture = vi.fn().mockResolvedValue(undefined);
    const probeOnce = vi.fn().mockResolvedValue(undefined);

    await expect(
      runStagingAccountDeletionMigrationWriteProbe(5_000, {
        createFixture: vi.fn().mockResolvedValue({
          userId: "synthetic-user",
          currentPassword: "SyntheticPass1!",
        }),
        probeOnce,
        cleanupFixture,
        getMonotonicTime: vi
          .fn()
          .mockReturnValueOnce(0)
          .mockReturnValueOnce(100)
          .mockReturnValueOnce(350)
          .mockReturnValueOnce(600)
          .mockReturnValueOnce(5_100)
          .mockReturnValueOnce(5_200)
          .mockReturnValueOnce(5_400),
        wait: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toEqual({
      probeCount: 2,
      writeProbeMaxDurationMs: 250,
    });
    expect(probeOnce).toHaveBeenCalledTimes(2);
    expect(probeOnce).toHaveBeenCalledWith("synthetic-user");
    expect(cleanupFixture).toHaveBeenCalledWith("synthetic-user");
  });

  it("write失敗時もsynthetic fixtureをcleanupし生Errorを隠す", async () => {
    const cleanupFixture = vi.fn().mockResolvedValue(undefined);

    await expect(
      runStagingAccountDeletionMigrationWriteProbe(5_000, {
        createFixture: vi.fn().mockResolvedValue({
          userId: "synthetic-user",
          currentPassword: "SyntheticPass1!",
        }),
        probeOnce: vi.fn().mockRejectedValue(new Error("raw write error")),
        cleanupFixture,
        getMonotonicTime: vi.fn().mockReturnValue(0),
        wait: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow("staging account deletion性能測定に失敗しました");
    expect(cleanupFixture).toHaveBeenCalledWith("synthetic-user");
  });

  it("fixture作成時間を除外し、作成完了後から指定時間write probeを続ける", async () => {
    let currentTime = 0;
    const probeOnce = vi.fn().mockImplementation(async () => {
      currentTime += 100;
    });

    await expect(
      runStagingAccountDeletionMigrationWriteProbe(5_000, {
        createFixture: vi.fn().mockImplementation(async () => {
          currentTime += 4_000;
          return {
            userId: "synthetic-user",
            currentPassword: "SyntheticPass1!",
          };
        }),
        probeOnce,
        cleanupFixture: vi.fn().mockResolvedValue(undefined),
        getMonotonicTime: () => currentTime,
        wait: vi.fn().mockImplementation(async (waitMs: number) => {
          currentTime += waitMs;
        }),
      }),
    ).resolves.toEqual({
      probeCount: 15,
      writeProbeMaxDurationMs: 100,
    });
    expect(probeOnce).toHaveBeenCalledTimes(15);
  });
});

describe("cleanupStagingAccountDeletionFixture", () => {
  it("synthetic内部IDに完全一致するUserと成功監査だけを削除する", async () => {
    const auditDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const userDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const client = {
      auditLog: { deleteMany: auditDeleteMany },
      user: { deleteMany: userDeleteMany },
    } as unknown as Parameters<typeof cleanupStagingAccountDeletionFixture>[0];

    await cleanupStagingAccountDeletionFixture(client, "synthetic-user");

    expect(auditDeleteMany).toHaveBeenCalledWith({
      where: {
        action: "USER_ACCOUNT_DELETE",
        result: "SUCCESS",
        actorId: "synthetic-user",
        targetType: "USER",
        targetId: "synthetic-user",
      },
    });
    expect(userDeleteMany).toHaveBeenCalledWith({
      where: { id: "synthetic-user" },
    });
  });
});

describe("verifyStagingAccountDeletionFixtureDeleted", () => {
  function createVerificationClient(counts: number[]) {
    const countMocks = counts.map((count) => vi.fn().mockResolvedValue(count));
    return {
      client: {
        user: { count: countMocks[0] },
        refreshToken: { count: countMocks[1] },
        emailVerification: { count: countMocks[2] },
        passwordResetToken: { count: countMocks[3] },
        weakElement: { count: countMocks[4] },
        gameSession: { count: countMocks[5] },
        gameAnswer: { count: countMocks[6] },
        gameQuestionSet: { count: countMocks[7] },
        userStats: { count: countMocks[8] },
      } as unknown as Parameters<typeof verifyStagingAccountDeletionFixtureDeleted>[0],
      countMocks,
    };
  }

  it("Userと直接・間接所有rowがすべて0件なら成功する", async () => {
    const { client } = createVerificationClient(Array(9).fill(0));
    await expect(
      verifyStagingAccountDeletionFixtureDeleted(client, "synthetic-user"),
    ).resolves.toBeUndefined();
  });

  it("GameAnswerを含む所有rowが1件でも残ればgeneric errorにする", async () => {
    const { client, countMocks } = createVerificationClient([0, 0, 0, 0, 0, 0, 1, 0, 0]);

    await expect(
      verifyStagingAccountDeletionFixtureDeleted(client, "synthetic-user"),
    ).rejects.toThrow("staging account deletion性能測定に失敗しました");
    expect(countMocks[6]).toHaveBeenCalledWith({
      where: { sessionId: { startsWith: "synthetic-user-session-" } },
    });
  });
});

describe("account deletion performance threshold", () => {
  it.each([
    [4_000, 2_000],
    [10_000, 5_000],
    [60_000, 5_000],
  ])("platform timeout %dmsから合格値%dmsを計算する", (timeoutMs, expected) => {
    expect(calculateAccountDeletionPerformanceThresholdMs(timeoutMs)).toBe(expected);
  });
});

describe("runStagingAccountDeletionPerformance", () => {
  const validInput = {
    sessionCount: 10,
    answerCount: 100,
    platformRequestTimeoutMs: 10_000,
  };

  it("実deleteCurrentUser経路を測定し、基準内なら件数と時間だけを返す", async () => {
    const dependencies = createDependencies();

    await expect(runStagingAccountDeletionPerformance(validInput, dependencies)).resolves.toEqual({
      maxGameSessions: 10,
      maxGameAnswers: 100,
      fixtureGameSessions: 10,
      fixtureGameAnswers: 100,
      durationMs: 250,
      thresholdMs: 5_000,
      passed: true,
    });
    expect(dependencies.deleteCurrentUser).toHaveBeenCalledWith({
      userId: "synthetic-user",
      currentPassword: "SyntheticPass1!",
    });
    expect(dependencies.verifyFixtureDeleted).toHaveBeenCalledWith("synthetic-user");
    expect(dependencies.cleanupFixture).toHaveBeenCalledWith("synthetic-user");
  });

  it("fixtureが既存最大件数未満なら作成前に拒否する", async () => {
    const dependencies = createDependencies();

    await expect(
      runStagingAccountDeletionPerformance({ ...validInput, sessionCount: 9 }, dependencies),
    ).rejects.toThrow("性能測定fixtureの件数が不正です");
    expect(dependencies.createFixture).not.toHaveBeenCalled();
  });

  it.each([
    { sessionCount: 0, answerCount: 0 },
    { sessionCount: MAX_STAGING_PERFORMANCE_SESSION_COUNT + 1, answerCount: 100 },
    { sessionCount: 10, answerCount: MAX_STAGING_PERFORMANCE_ANSWER_COUNT + 1 },
  ])("fixture上限外を作成前に拒否する: %j", async (invalidCounts) => {
    const dependencies = createDependencies({
      preview: vi.fn().mockResolvedValue({ maxGameSessions: 0, maxGameAnswers: 0 }),
    });

    await expect(
      runStagingAccountDeletionPerformance({ ...validInput, ...invalidCounts }, dependencies),
    ).rejects.toThrow("性能測定fixtureの件数が不正です");
    expect(dependencies.createFixture).not.toHaveBeenCalled();
  });

  it("deleteCurrentUser失敗時もfinallyでsynthetic fixtureだけをcleanupする", async () => {
    const dependencies = createDependencies({
      deleteCurrentUser: vi.fn().mockRejectedValue(new Error("raw database error")),
    });

    await expect(runStagingAccountDeletionPerformance(validInput, dependencies)).rejects.toThrow(
      "staging account deletion性能測定に失敗しました",
    );
    expect(dependencies.cleanupFixture).toHaveBeenCalledWith("synthetic-user");
  });

  it("合格基準超過時はcleanup後にproduction blockerとして失敗する", async () => {
    const dependencies = createDependencies({
      getMonotonicTime: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(5_101),
    });

    await expect(runStagingAccountDeletionPerformance(validInput, dependencies)).rejects.toThrow(
      "同期削除の性能基準を超過しました",
    );
    expect(dependencies.cleanupFixture).toHaveBeenCalledWith("synthetic-user");
  });
});
