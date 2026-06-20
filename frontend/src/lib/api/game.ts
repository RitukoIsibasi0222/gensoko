import { API_BASE_URL } from '$lib/api/config';
import { ApiError, parseErrorResponse } from '$lib/api/errors';
import type { GameMode, GameQuestionsResponse } from '$lib/game/types';

export type GetGameQuestionsOptions = {
  mode: GameMode;
  accessToken: string;
  signal?: AbortSignal;
};

type GameQuestionsFetchOptions = {
  method: 'GET';
  credentials: 'include';
  headers: {
    Authorization: string;
  };
  signal?: AbortSignal;
};

function isGameChoice(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const choice = value as Record<string, unknown>;
  return (
    typeof choice.choiceId === 'string' &&
    typeof choice.text === 'string' &&
    !('correctChoiceId' in choice) &&
    !('elementId' in choice)
  );
}

function isGameQuestion(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const question = value as Record<string, unknown>;
  return (
    typeof question.questionId === 'string' &&
    typeof question.prompt === 'string' &&
    Array.isArray(question.choices) &&
    question.choices.every(isGameChoice) &&
    !('correctChoiceId' in question) &&
    !('elementId' in question)
  );
}

function isGameQuestionsResponse(value: unknown): value is GameQuestionsResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    typeof response.questionSetId === 'string' &&
    typeof response.expiresAt === 'string' &&
    Array.isArray(response.questions) &&
    response.questions.every(isGameQuestion)
  );
}

function buildGameQuestionsUrl(mode: GameMode): string {
  const searchParams = new URLSearchParams({ mode });
  return `${API_BASE_URL}/game/questions?${searchParams.toString()}`;
}

export async function getGameQuestions({
  mode,
  accessToken,
  signal
}: GetGameQuestionsOptions): Promise<GameQuestionsResponse> {
  const fetchOptions: GameQuestionsFetchOptions = {
    method: 'GET',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  };

  if (signal) {
    fetchOptions.signal = signal;
  }

  const response = await fetch(buildGameQuestionsUrl(mode), fetchOptions);

  if (!response.ok) {
    await parseErrorResponse(response, 'ゲーム問題の取得に失敗しました');
  }

  const data = (await response.json()) as unknown;
  if (!isGameQuestionsResponse(data)) {
    throw new ApiError(500, 'ゲーム問題のレスポンス形式が不正です', data);
  }

  return data;
}
