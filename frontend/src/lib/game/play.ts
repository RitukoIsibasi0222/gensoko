import { GAME_MODE_CONFIGS } from '$lib/game/modes';
import type { GameAnswerDraft, GameMode, MockGamePlayQuestion } from '$lib/game/types';

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

export function getNextQuestionIndex(currentIndex: number, totalCount: number): number | null {
  const nextIndex = currentIndex + 1;
  return nextIndex < totalCount ? nextIndex : null;
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
