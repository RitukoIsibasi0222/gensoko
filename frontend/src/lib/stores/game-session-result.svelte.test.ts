import { beforeEach, describe, expect, it } from 'vitest';
import { gameSessionResultStore } from './game-session-result.svelte';
import type { GameSessionResponse } from '$lib/game/types';

const SESSION_RESULT: GameSessionResponse = {
  sessionId: 'session-1',
  mode: 'SYMBOL_TO_NAME_LV1',
  totalCount: 2,
  correctCount: 1,
  totalScore: 155,
  maxStreak: 1,
  durationSec: 22,
  playedAt: '2026-06-20T12:35:00.000Z',
  results: [
    {
      questionId: 'q1',
      elementId: 1,
      prompt: 'H',
      chosenChoiceId: '1',
      isCorrect: true,
      correctAnswer: '水素',
      yourAnswer: '水素',
      answerTimeSec: 4,
      score: 155
    },
    {
      questionId: 'q2',
      elementId: 8,
      prompt: 'O',
      chosenChoiceId: null,
      isCorrect: false,
      correctAnswer: '酸素',
      yourAnswer: null,
      answerTimeSec: 15,
      score: 0
    }
  ]
};

describe('gameSessionResultStore', () => {
  beforeEach(() => {
    gameSessionResultStore.clear();
  });

  it('初期状態では result が null', () => {
    expect(gameSessionResultStore.result).toBeNull();
  });

  it('set() した結果を保持する', () => {
    gameSessionResultStore.set(SESSION_RESULT);

    expect(gameSessionResultStore.result).toEqual(SESSION_RESULT);
  });

  it('matches() は保持中 result の sessionId と query の一致を返す', () => {
    gameSessionResultStore.set(SESSION_RESULT);

    expect(gameSessionResultStore.matches('session-1')).toBe(true);
    expect(gameSessionResultStore.matches('other-session')).toBe(false);
    expect(gameSessionResultStore.matches(null)).toBe(false);
  });

  it('clear() で result を null に戻す', () => {
    gameSessionResultStore.set(SESSION_RESULT);
    gameSessionResultStore.clear();

    expect(gameSessionResultStore.result).toBeNull();
    expect(gameSessionResultStore.matches('session-1')).toBe(false);
  });
});
