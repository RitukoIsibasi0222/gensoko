import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    userStats: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma.js";
import { createRankingService } from "./ranking.service.js";

const { getAllTimeRanking, getWeeklyRanking } = createRankingService(prisma as never);

const NOW = new Date("2026-06-20T12:00:00.000Z");
const WEEK_START = new Date("2026-06-14T15:00:00.000Z");

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe("ranking service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("週間ランキングを上位50件・同点順位・正答率つきで返す", async () => {
    vi.mocked(prisma.userStats.findMany).mockResolvedValue([
      {
        userId: "user-1",
        weeklyScore: 15000,
        allTimeScore: 50000,
        totalGames: 30,
        totalCorrect: 86,
        totalAnswered: 100,
        user: { username: "taro" },
      },
      {
        userId: "user-2",
        weeklyScore: 12000,
        allTimeScore: 60000,
        totalGames: 20,
        totalCorrect: 9,
        totalAnswered: 10,
        user: { username: "hanako" },
      },
      {
        userId: "user-3",
        weeklyScore: 12000,
        allTimeScore: 70000,
        totalGames: 18,
        totalCorrect: 0,
        totalAnswered: 0,
        user: { username: "jiro" },
      },
      {
        userId: "user-4",
        weeklyScore: 8000,
        allTimeScore: 80000,
        totalGames: 12,
        totalCorrect: 1,
        totalAnswered: 3,
        user: { username: "sabu" },
      },
    ] as never);

    const result = await getWeeklyRanking();

    expect(prisma.userStats.findMany).toHaveBeenCalledWith({
      where: {
        totalGames: { gt: 0 },
        user: { isActive: true },
        weeklyScoreWeekStart: WEEK_START,
      },
      orderBy: [{ weeklyScore: "desc" }, { userId: "asc" }],
      take: 50,
      select: {
        userId: true,
        weeklyScore: true,
        allTimeScore: true,
        totalGames: true,
        totalCorrect: true,
        totalAnswered: true,
        user: { select: { username: true } },
      },
    });
    expect(result).toEqual({
      ranking: [
        { rank: 1, username: "taro", weeklyScore: 15000, totalGames: 30, accuracyRate: 86 },
        { rank: 2, username: "hanako", weeklyScore: 12000, totalGames: 20, accuracyRate: 90 },
        { rank: 2, username: "jiro", weeklyScore: 12000, totalGames: 18, accuracyRate: 0 },
        { rank: 4, username: "sabu", weeklyScore: 8000, totalGames: 12, accuracyRate: 33 },
      ],
      myRank: null,
    });
    expect(prisma.userStats.findUnique).not.toHaveBeenCalled();
    expect(prisma.userStats.count).not.toHaveBeenCalled();
  });

  it("全期間ランキングでは allTimeScore を表示スコアと順位計算に使う", async () => {
    vi.mocked(prisma.userStats.findMany).mockResolvedValue([
      {
        userId: "user-1",
        weeklyScore: 100,
        allTimeScore: 92000,
        totalGames: 180,
        totalCorrect: 91,
        totalAnswered: 100,
        user: { username: "hanako" },
      },
    ] as never);

    const result = await getAllTimeRanking();

    expect(prisma.userStats.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ allTimeScore: "desc" }, { userId: "asc" }],
      }),
    );
    expect(result).toEqual({
      ranking: [
        { rank: 1, username: "hanako", allTimeScore: 92000, totalGames: 180, accuracyRate: 91 },
      ],
      myRank: null,
    });
  });

  it("ログインユーザーがランキング対象なら自分より高スコアの人数 + 1 を myRank にする", async () => {
    vi.mocked(prisma.userStats.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue({
      userId: "user-me",
      weeklyScore: 12000,
      weeklyScoreWeekStart: WEEK_START,
      allTimeScore: 70000,
      totalGames: 8,
      user: { isActive: true },
    } as never);
    vi.mocked(prisma.userStats.count).mockResolvedValue(5 as never);

    const result = await getWeeklyRanking("user-me");

    expect(prisma.userStats.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-me" },
      select: {
        weeklyScore: true,
        weeklyScoreWeekStart: true,
        allTimeScore: true,
        totalGames: true,
        user: { select: { isActive: true } },
      },
    });
    expect(prisma.userStats.count).toHaveBeenCalledWith({
      where: {
        totalGames: { gt: 0 },
        user: { isActive: true },
        weeklyScoreWeekStart: WEEK_START,
        weeklyScore: { gt: 12000 },
      },
    });
    expect(result.myRank).toBe(6);
  });

  it("ログインユーザーに統計がない、未プレイ、停止中の場合は myRank を null にする", async () => {
    vi.mocked(prisma.userStats.findMany).mockResolvedValue([] as never);

    vi.mocked(prisma.userStats.findUnique).mockResolvedValueOnce(null as never);
    await expect(getWeeklyRanking("missing-stats")).resolves.toMatchObject({ myRank: null });

    vi.mocked(prisma.userStats.findUnique).mockResolvedValueOnce({
      weeklyScore: 100,
      weeklyScoreWeekStart: WEEK_START,
      allTimeScore: 200,
      totalGames: 0,
      user: { isActive: true },
    } as never);
    await expect(getWeeklyRanking("not-played")).resolves.toMatchObject({ myRank: null });

    vi.mocked(prisma.userStats.findUnique).mockResolvedValueOnce({
      weeklyScore: 100,
      weeklyScoreWeekStart: WEEK_START,
      allTimeScore: 200,
      totalGames: 1,
      user: { isActive: false },
    } as never);
    await expect(getWeeklyRanking("inactive")).resolves.toMatchObject({ myRank: null });

    expect(prisma.userStats.count).not.toHaveBeenCalled();
  });

  it("週間ランキング対象外の週識別子なら myRank を null にする", async () => {
    vi.mocked(prisma.userStats.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue({
      weeklyScore: 12000,
      weeklyScoreWeekStart: new Date("2026-06-07T15:00:00.000Z"),
      allTimeScore: 70000,
      totalGames: 8,
      user: { isActive: true },
    } as never);

    await expect(getWeeklyRanking("stale-week-user")).resolves.toMatchObject({ myRank: null });
    expect(prisma.userStats.count).not.toHaveBeenCalled();
  });

  it("ログイン時はランキング一覧と自分の順位取得を並列に開始する", async () => {
    const findManyDeferred = createDeferred<never[]>();
    vi.mocked(prisma.userStats.findMany).mockReturnValue(findManyDeferred.promise as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue({
      userId: "user-me",
      weeklyScore: 12000,
      weeklyScoreWeekStart: WEEK_START,
      allTimeScore: 70000,
      totalGames: 8,
      user: { isActive: true },
    } as never);
    vi.mocked(prisma.userStats.count).mockResolvedValue(5 as never);

    const resultPromise = getWeeklyRanking("user-me");
    await Promise.resolve();

    expect(prisma.userStats.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-me" },
      select: {
        weeklyScore: true,
        weeklyScoreWeekStart: true,
        allTimeScore: true,
        totalGames: true,
        user: { select: { isActive: true } },
      },
    });

    findManyDeferred.resolve([]);
    await expect(resultPromise).resolves.toEqual({ ranking: [], myRank: 6 });
  });

  it("保存済み統計値に不整合があってもレスポンスでは表示範囲へ正規化する", async () => {
    vi.mocked(prisma.userStats.findMany).mockResolvedValue([
      {
        userId: "user-1",
        weeklyScore: -100,
        allTimeScore: -200,
        totalGames: -3,
        totalCorrect: 12,
        totalAnswered: 10,
        user: { username: "broken" },
      },
    ] as never);

    const result = await getWeeklyRanking();

    expect(result.ranking[0]).toEqual({
      rank: 1,
      username: "broken",
      weeklyScore: 0,
      totalGames: 0,
      accuracyRate: 100,
    });
  });
});
