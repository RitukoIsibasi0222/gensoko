import { API_BASE_URL } from '$lib/api/config';
import { ApiError, parseErrorResponse } from '$lib/api/errors';
import { GAME_MODE_CONFIGS } from '$lib/game/modes';
import type {
  GameMode,
  GameQuestionsResponse,
  GameSessionAnswerDraft,
  GameSessionHistoryItem,
  GameSessionResponse,
  GameSessionsResponse
} from '$lib/game/types';

export type GetGameQuestionsOptions = {
  mode: GameMode;
  accessToken: string;
  signal?: AbortSignal;
};

export type SubmitGameSessionOptions = {
  questionSetId: string;
  mode: GameMode;
  answers: readonly GameSessionAnswerDraft[];
  durationSec: number;
  accessToken: string;
  signal?: AbortSignal;
};

export type GetGameSessionOptions = {
  sessionId: string;
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

type GetGameSessionFetchOptions = {
  method: 'GET';
  credentials: 'include';
  headers: {
    Authorization: string;
  };
  signal?: AbortSignal;
};

type SubmitGameSessionFetchOptions = {
  method: 'POST';
  credentials: 'include';
  headers: {
    Authorization: string;
    'Content-Type': 'application/json';
  };
  body: string;
  signal?: AbortSignal;
};

function isGameMode(value: unknown): value is GameMode {
  return typeof value === 'string' && GAME_MODE_CONFIGS.some((config) => config.mode === value);
}

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

function isGameSessionResultItem(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const result = value as Record<string, unknown>;
  return (
    typeof result.questionId === 'string' &&
    typeof result.elementId === 'number' &&
    typeof result.prompt === 'string' &&
    (result.chosenChoiceId === null || typeof result.chosenChoiceId === 'string') &&
    typeof result.isCorrect === 'boolean' &&
    typeof result.correctAnswer === 'string' &&
    (result.yourAnswer === null || typeof result.yourAnswer === 'string') &&
    typeof result.answerTimeSec === 'number' &&
    typeof result.score === 'number'
  );
}

function isGameSessionResponse(value: unknown): value is GameSessionResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    typeof response.sessionId === 'string' &&
    isGameMode(response.mode) &&
    typeof response.totalCount === 'number' &&
    typeof response.correctCount === 'number' &&
    typeof response.totalScore === 'number' &&
    typeof response.maxStreak === 'number' &&
    typeof response.durationSec === 'number' &&
    typeof response.playedAt === 'string' &&
    Array.isArray(response.results) &&
    response.results.every(isGameSessionResultItem)
  );
}

function buildGameQuestionsUrl(mode: GameMode): string {
  const searchParams = new URLSearchParams({ mode });
  return `${API_BASE_URL}/game/questions?${searchParams.toString()}`;
}

function buildGameSessionsUrl(): string {
  return `${API_BASE_URL}/game/sessions`;
}

function buildGameSessionUrl(sessionId: string): string {
  return `${buildGameSessionsUrl()}/${encodeURIComponent(sessionId)}`;
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

export async function getGameSession({
  sessionId,
  accessToken,
  signal
}: GetGameSessionOptions): Promise<GameSessionResponse> {
  const fetchOptions: GetGameSessionFetchOptions = {
    method: 'GET',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  };

  if (signal) {
    fetchOptions.signal = signal;
  }

  const response = await fetch(buildGameSessionUrl(sessionId), fetchOptions);

  if (!response.ok) {
    await parseErrorResponse(response, 'ゲーム結果の取得に失敗しました');
  }

  const data = (await response.json()) as unknown;
  if (!isGameSessionResponse(data)) {
    throw new ApiError(500, 'ゲーム結果のレスポンス形式が不正です', data);
  }

  return data;
}

export async function submitGameSession({
  questionSetId,
  mode,
  answers,
  durationSec,
  accessToken,
  signal
}: SubmitGameSessionOptions): Promise<GameSessionResponse> {
  const fetchOptions: SubmitGameSessionFetchOptions = {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      questionSetId,
      mode,
      answers,
      durationSec
    })
  };

  if (signal) {
    fetchOptions.signal = signal;
  }

  const response = await fetch(buildGameSessionsUrl(), fetchOptions);

  if (!response.ok) {
    await parseErrorResponse(response, 'ゲーム結果の送信に失敗しました');
  }

  const data = (await response.json()) as unknown;
  if (!isGameSessionResponse(data)) {
    throw new ApiError(500, 'ゲーム結果のレスポンス形式が不正です', data);
  }

  return data;
}

export type GetGameSessionsOptions = {
  accessToken: string;
  limit?: number;
  cursor?: string | null;
  mode?: GameMode | null;
  signal?: AbortSignal;
};

type GetGameSessionsFetchOptions = {
  method: 'GET';
  credentials: 'include';
  headers: {
    Authorization: string;
  };
  signal?: AbortSignal;
};

function isGameSessionHistoryItem(value: unknown): value is GameSessionHistoryItem {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const session = value as Record<string, unknown>;
  return (
    typeof session.sessionId === 'string' &&
    isGameMode(session.mode) &&
    typeof session.totalCount === 'number' &&
    typeof session.correctCount === 'number' &&
    typeof session.totalScore === 'number' &&
    typeof session.maxStreak === 'number' &&
    typeof session.durationSec === 'number' &&
    typeof session.playedAt === 'string' &&
    !('results' in session)
  );
}

function isGameSessionsResponse(value: unknown): value is GameSessionsResponse {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    Array.isArray(response.sessions) &&
    response.sessions.every(isGameSessionHistoryItem) &&
    (response.nextCursor === null || typeof response.nextCursor === 'string')
  );
}

function buildGameSessionHistoryUrl({ limit, cursor, mode }: GetGameSessionsOptions): string {
  const searchParams = new URLSearchParams();

  if (limit !== undefined) {
    searchParams.set('limit', String(limit));
  }

  const normalizedCursor = cursor?.trim() ?? '';
  if (normalizedCursor.length > 0) {
    searchParams.set('cursor', normalizedCursor);
  }

  if (mode) {
    searchParams.set('mode', mode);
  }

  const queryString = searchParams.toString();
  return queryString.length > 0
    ? buildGameSessionsUrl() + '?' + queryString
    : buildGameSessionsUrl();
}

export async function getGameSessions(
  options: GetGameSessionsOptions
): Promise<GameSessionsResponse> {
  const fetchOptions: GetGameSessionsFetchOptions = {
    method: 'GET',
    credentials: 'include',
    headers: {
      Authorization: 'Bearer ' + options.accessToken
    }
  };

  if (options.signal) {
    fetchOptions.signal = options.signal;
  }

  const response = await fetch(buildGameSessionHistoryUrl(options), fetchOptions);

  if (!response.ok) {
    await parseErrorResponse(response, 'ゲーム履歴の取得に失敗しました');
  }

  const data = (await response.json()) as unknown;
  if (!isGameSessionsResponse(data)) {
    throw new ApiError(500, 'ゲーム履歴のレスポンス形式が不正です', data);
  }

  return data;
}
