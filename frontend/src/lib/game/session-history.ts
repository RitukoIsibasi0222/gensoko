import { GAME_MODE_CONFIGS } from './modes';
import type { GameMode, GameSessionHistoryQuery } from './types';

export const DEFAULT_GAME_SESSION_HISTORY_LIMIT = 20;
const MAX_GAME_SESSION_HISTORY_LIMIT = 50;
const gameSessionPlayedAtFormatter = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

type RawGameSessionHistoryQuery = {
  limit?: string | number | null;
  cursor?: string | null;
  mode?: string | null;
};

type AccuracyInput = {
  correctCount: number;
  totalCount: number;
};

function isGameMode(value: string | null | undefined): value is GameMode {
  return typeof value === 'string' && GAME_MODE_CONFIGS.some((config) => config.mode === value);
}

function normalizeLimit(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') {
    return DEFAULT_GAME_SESSION_HISTORY_LIMIT;
  }

  const numericValue = typeof value === 'number' ? value : Number(value);
  if (
    !Number.isInteger(numericValue) ||
    numericValue < 1 ||
    numericValue > MAX_GAME_SESSION_HISTORY_LIMIT
  ) {
    return DEFAULT_GAME_SESSION_HISTORY_LIMIT;
  }

  return numericValue;
}

function normalizeCursor(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedCursor = value.trim();
  return normalizedCursor.length > 0 ? normalizedCursor : null;
}

export function normalizeGameSessionHistoryQuery(
  query: RawGameSessionHistoryQuery
): GameSessionHistoryQuery {
  const normalizedMode = isGameMode(query.mode) ? query.mode : null;

  return {
    limit: normalizeLimit(query.limit),
    cursor: normalizeCursor(query.cursor),
    mode: normalizedMode
  };
}

export function getGameSessionAccuracy({ correctCount, totalCount }: AccuracyInput): number {
  if (totalCount <= 0) {
    return 0;
  }

  return Math.round((correctCount / totalCount) * 100);
}

export function formatGameSessionPlayedAt(playedAt: string): string {
  const date = new Date(playedAt);
  if (Number.isNaN(date.getTime())) {
    return playedAt;
  }

  return gameSessionPlayedAtFormatter.format(date);
}
