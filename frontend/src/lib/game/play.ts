import { GAME_MODE_CONFIGS } from '$lib/game/modes';
import type {
  GameAnswerDraft,
  GameMode,
  GamePlayQuestion,
  GameSessionAnswerDraft,
  MockGamePlayQuestion
} from '$lib/game/types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeGameModeParam(value: string | null): GameMode | null {
  if (value === null) {
    return null;
  }

  const mode = GAME_MODE_CONFIGS.find((config) => config.mode === value)?.mode;
  return mode ?? null;
}

export function getProgressLabel(currentIndex: number, totalCount: number): string {
  if (totalCount <= 0) {
    return '0 / 0問';
  }

  const currentNumber = clamp(currentIndex + 1, 1, totalCount);
  return `${currentNumber} / ${totalCount}問`;
}

export function getTimerPercent(remainingSec: number, timeLimitSec: number): number {
  if (timeLimitSec <= 0) {
    return 0;
  }

  return clamp((remainingSec / timeLimitSec) * 100, 0, 100);
}

export function buildAnswerDraft({
  question,
  chosenChoiceId,
  remainingSec,
  timeLimitSec
}: {
  question: MockGamePlayQuestion;
  chosenChoiceId: string | null;
  remainingSec: number;
  timeLimitSec: number;
}): GameAnswerDraft {
  const normalizedRemainingSec = clamp(remainingSec, 0, timeLimitSec);
  const answerTimeSec = timeLimitSec - normalizedRemainingSec;
  const timedOut = chosenChoiceId === null;

  return {
    questionId: question.questionId,
    chosenChoiceId,
    answerTimeSec,
    isCorrect: !timedOut && chosenChoiceId === question.correctChoiceId,
    timedOut
  };
}

export function buildSessionAnswerDraft({
  question,
  chosenChoiceId,
  remainingSec,
  timeLimitSec
}: {
  question: GamePlayQuestion;
  chosenChoiceId: string | null;
  remainingSec: number;
  timeLimitSec: number;
}): GameSessionAnswerDraft {
  const normalizedRemainingSec = clamp(remainingSec, 0, timeLimitSec);

  return {
    questionId: question.questionId,
    chosenChoiceId,
    answerTimeSec: timeLimitSec - normalizedRemainingSec
  };
}

export function getNextQuestionIndex(currentIndex: number, totalCount: number): number | null {
  const nextIndex = currentIndex + 1;
  return nextIndex < totalCount ? nextIndex : null;
}

export function calculateAnswerDurationSec(
  answers: readonly { answerTimeSec: number }[],
  maxDurationSec: number
): number {
  const total = answers.reduce((sum, answer) => sum + answer.answerTimeSec, 0);
  return Math.round(clamp(total, 0, maxDurationSec));
}

export function summarizeAnswers(answers: readonly GameAnswerDraft[]): {
  correctCount: number;
  totalCount: number;
} {
  return {
    correctCount: answers.filter((answer) => answer.isCorrect).length,
    totalCount: answers.length
  };
}
