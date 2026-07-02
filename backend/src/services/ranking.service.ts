import { prisma } from "../lib/prisma.js";
import { getWeeklyScoreWeekStart, isSameWeeklyScoreWeek } from "../lib/weekly-score.js";
import { calculateAccuracyRate, normalizeNonNegativeCount } from "../lib/stats.js";

const RANKING_LIMIT = 50;

export type RankingPeriod = "weekly" | "alltime";

export type WeeklyRankingEntry = {
  rank: number;
  username: string;
  weeklyScore: number;
  totalGames: number;
  accuracyRate: number;
};

export type AllTimeRankingEntry = {
  rank: number;
  username: string;
  allTimeScore: number;
  totalGames: number;
  accuracyRate: number;
};

export type WeeklyRankingResponse = {
  ranking: WeeklyRankingEntry[];
  myRank: number | null;
};

export type AllTimeRankingResponse = {
  ranking: AllTimeRankingEntry[];
  myRank: number | null;
};

type RankingRow = {
  userId: string;
  weeklyScore: number;
  allTimeScore: number;
  totalGames: number;
  totalCorrect: number;
  totalAnswered: number;
  user: { username: string };
};

type RankingTargetStats = {
  weeklyScore: number;
  weeklyScoreWeekStart: Date | null;
  allTimeScore: number;
  totalGames: number;
  user: { isActive: boolean; deletedAt: Date | null };
};

type RankingScoreField = "weeklyScore" | "allTimeScore";

const activeRankingTargetWhere = {
  totalGames: { gt: 0 },
  user: { isActive: true, deletedAt: null },
} as const;

const rankingSelect = {
  userId: true,
  weeklyScore: true,
  allTimeScore: true,
  totalGames: true,
  totalCorrect: true,
  totalAnswered: true,
  user: { select: { username: true } },
} as const;

const myRankSelect = {
  weeklyScore: true,
  weeklyScoreWeekStart: true,
  allTimeScore: true,
  totalGames: true,
  user: { select: { isActive: true, deletedAt: true } },
} as const;

function getScoreField(period: RankingPeriod): RankingScoreField {
  return period === "weekly" ? "weeklyScore" : "allTimeScore";
}

function getRankingOrderBy(period: RankingPeriod) {
  return period === "weekly"
    ? [{ weeklyScore: "desc" as const }, { userId: "asc" as const }]
    : [{ allTimeScore: "desc" as const }, { userId: "asc" as const }];
}

function isActiveRankingTarget(stats: RankingTargetStats | null): stats is RankingTargetStats {
  return (
    stats !== null && stats.totalGames > 0 && stats.user.isActive && stats.user.deletedAt === null
  );
}

function getNormalizedScore(row: Pick<RankingRow, RankingScoreField>, field: RankingScoreField) {
  return normalizeNonNegativeCount(row[field]);
}

function buildWeeklyEntry(row: RankingRow, rank: number): WeeklyRankingEntry {
  return {
    rank,
    username: row.user.username,
    weeklyScore: normalizeNonNegativeCount(row.weeklyScore),
    totalGames: normalizeNonNegativeCount(row.totalGames),
    accuracyRate: calculateAccuracyRate(row.totalCorrect, row.totalAnswered),
  };
}

function buildAllTimeEntry(row: RankingRow, rank: number): AllTimeRankingEntry {
  return {
    rank,
    username: row.user.username,
    allTimeScore: normalizeNonNegativeCount(row.allTimeScore),
    totalGames: normalizeNonNegativeCount(row.totalGames),
    accuracyRate: calculateAccuracyRate(row.totalCorrect, row.totalAnswered),
  };
}

function buildRankingEntries(period: "weekly", rows: RankingRow[]): WeeklyRankingEntry[];
function buildRankingEntries(period: "alltime", rows: RankingRow[]): AllTimeRankingEntry[];
function buildRankingEntries(period: RankingPeriod, rows: RankingRow[]) {
  const scoreField = getScoreField(period);
  let previousScore: number | null = null;
  let previousRank = 0;

  return rows.map((row, index) => {
    const score = getNormalizedScore(row, scoreField);
    const rank = previousScore === score ? previousRank : index + 1;
    previousScore = score;
    previousRank = rank;

    return period === "weekly" ? buildWeeklyEntry(row, rank) : buildAllTimeEntry(row, rank);
  });
}

async function getMyRank(
  period: RankingPeriod,
  userId: string | undefined,
  weeklyScoreWeekStart: Date,
): Promise<number | null> {
  if (!userId) {
    return null;
  }

  const stats = await prisma.userStats.findUnique({
    where: { userId },
    select: myRankSelect,
  });

  if (!isActiveRankingTarget(stats)) {
    return null;
  }

  const scoreField = getScoreField(period);

  if (
    scoreField === "weeklyScore" &&
    !isSameWeeklyScoreWeek(stats.weeklyScoreWeekStart, weeklyScoreWeekStart)
  ) {
    return null;
  }

  const score = normalizeNonNegativeCount(stats[scoreField]);
  const scoreWhere =
    scoreField === "weeklyScore"
      ? { weeklyScoreWeekStart, weeklyScore: { gt: score } }
      : { allTimeScore: { gt: score } };

  const higherScoreCount = await prisma.userStats.count({
    where: {
      ...activeRankingTargetWhere,
      ...scoreWhere,
    },
  });

  return higherScoreCount + 1;
}

export async function getWeeklyRanking(userId?: string): Promise<WeeklyRankingResponse> {
  const weeklyScoreWeekStart = getWeeklyScoreWeekStart(new Date());
  const [rows, myRank] = await Promise.all([
    prisma.userStats.findMany({
      where: { ...activeRankingTargetWhere, weeklyScoreWeekStart },
      orderBy: getRankingOrderBy("weekly"),
      take: RANKING_LIMIT,
      select: rankingSelect,
    }),
    getMyRank("weekly", userId, weeklyScoreWeekStart),
  ]);

  return {
    ranking: buildRankingEntries("weekly", rows),
    myRank,
  };
}
export async function getAllTimeRanking(userId?: string): Promise<AllTimeRankingResponse> {
  const [rows, myRank] = await Promise.all([
    prisma.userStats.findMany({
      where: activeRankingTargetWhere,
      orderBy: getRankingOrderBy("alltime"),
      take: RANKING_LIMIT,
      select: rankingSelect,
    }),
    getMyRank("alltime", userId, getWeeklyScoreWeekStart(new Date())),
  ]);

  return {
    ranking: buildRankingEntries("alltime", rows),
    myRank,
  };
}
