import { prisma } from "../lib/prisma.js";

export type ElementMasteryStatus = "unlearned" | "learning" | "mastered";

type GameSessionWithAnswers = {
  playedAt: Date;
  answers: {
    elementId: number;
    isCorrect: boolean;
  }[];
};

const REQUIRED_CONSECUTIVE_CORRECT_COUNT = 2;

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

export async function getElementMasteryStatusMap(
  userId: string,
  elementIds: readonly number[],
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

  const sessions: GameSessionWithAnswers[] = await prisma.gameSession.findMany({
    where: { userId },
    orderBy: { playedAt: "desc" },
    select: {
      playedAt: true,
      answers: {
        where: {
          elementId: { in: targetElementIds },
        },
        select: {
          elementId: true,
          isCorrect: true,
        },
      },
    },
  });

  sessionLoop: for (const session of sessions) {
    for (const answer of session.answers) {
      if (!elementIdsNeedingAnswers.has(answer.elementId)) {
        continue;
      }

      const recentAnswers = recentAnswersByElement.get(answer.elementId);
      if (!recentAnswers) {
        continue;
      }

      recentAnswers.push(answer.isCorrect);
      if (recentAnswers.length >= REQUIRED_CONSECUTIVE_CORRECT_COUNT) {
        elementIdsNeedingAnswers.delete(answer.elementId);

        if (elementIdsNeedingAnswers.size === 0) {
          break sessionLoop;
        }
      }
    }
  }

  const statusMap = new Map<number, ElementMasteryStatus>();
  for (const elementId of targetElementIds) {
    statusMap.set(elementId, resolveMasteryStatus(recentAnswersByElement.get(elementId) ?? []));
  }

  return statusMap;
}
