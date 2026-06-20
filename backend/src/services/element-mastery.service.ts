import { prisma } from "../lib/prisma.js";

export type ElementMasteryStatus = "unlearned" | "learning" | "mastered";

type ElementMasteryClient = {
  gameSession: {
    findMany: typeof prisma.gameSession.findMany;
  };
};

type GameSessionWithAnswers = {
  answers: {
    elementId: number;
    isCorrect: boolean;
  }[];
};

const REQUIRED_CONSECUTIVE_CORRECT_COUNT = 2;
const GAME_SESSION_PAGE_SIZE = 50;

function resolveMasteryStatus(recentAnswers: boolean[]): ElementMasteryStatus {
  if (recentAnswers.length === 0) {
    return "unlearned";
  }

  const latestAnswers = recentAnswers.slice(0, REQUIRED_CONSECUTIVE_CORRECT_COUNT);
  if (
    latestAnswers.length === REQUIRED_CONSECUTIVE_CORRECT_COUNT &&
    latestAnswers.every((isCorrect) => isCorrect)
  ) {
    return "mastered";
  }

  return "learning";
}

function summarizeSessionAnswersByElement(
  answers: readonly GameSessionWithAnswers["answers"][number][],
): Map<number, boolean> {
  const outcomes = new Map<number, boolean>();

  for (const answer of answers) {
    const currentOutcome = outcomes.get(answer.elementId) ?? true;
    outcomes.set(answer.elementId, currentOutcome && answer.isCorrect);
  }

  return outcomes;
}

export async function getElementMasteryStatusMap(
  userId: string,
  elementIds: readonly number[],
  client: ElementMasteryClient = prisma,
): Promise<Map<number, ElementMasteryStatus>> {
  const targetElementIds = [...new Set(elementIds)];
  if (targetElementIds.length === 0) {
    return new Map();
  }

  const elementIdsNeedingAnswers = new Set(targetElementIds);
  const recentAnswersByElement = new Map<number, boolean[]>();

  for (const elementId of targetElementIds) {
    recentAnswersByElement.set(elementId, []);
  }

  let skip = 0;
  let hasMoreSessions = true;

  while (elementIdsNeedingAnswers.size > 0 && hasMoreSessions) {
    const sessions: GameSessionWithAnswers[] = await client.gameSession.findMany({
      where: { userId },
      orderBy: [{ playedAt: "desc" }, { id: "desc" }],
      skip,
      take: GAME_SESSION_PAGE_SIZE,
      select: {
        answers: {
          where: {
            elementId: { in: [...elementIdsNeedingAnswers] },
          },
          select: {
            elementId: true,
            isCorrect: true,
          },
        },
      },
    });

    hasMoreSessions = sessions.length === GAME_SESSION_PAGE_SIZE;
    skip += sessions.length;

    for (const session of sessions) {
      const sessionOutcomes = summarizeSessionAnswersByElement(session.answers);

      for (const [elementId, isCorrect] of sessionOutcomes) {
        if (!elementIdsNeedingAnswers.has(elementId)) {
          continue;
        }

        const recentAnswers = recentAnswersByElement.get(elementId);
        if (!recentAnswers) {
          continue;
        }

        recentAnswers.push(isCorrect);
        if (recentAnswers.length >= REQUIRED_CONSECUTIVE_CORRECT_COUNT) {
          elementIdsNeedingAnswers.delete(elementId);

          if (elementIdsNeedingAnswers.size === 0) {
            break;
          }
        }
      }

      if (elementIdsNeedingAnswers.size === 0) {
        break;
      }
    }
  }

  const statusMap = new Map<number, ElementMasteryStatus>();
  for (const elementId of targetElementIds) {
    statusMap.set(elementId, resolveMasteryStatus(recentAnswersByElement.get(elementId) ?? []));
  }

  return statusMap;
}
