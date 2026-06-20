import { describe, expect, it } from 'vitest';
import { normalizeGameSessionIdParam } from '$lib/game/session-result';

describe('normalizeGameSessionIdParam', () => {
  it('前後空白を除去した sessionId を返す', () => {
    expect(normalizeGameSessionIdParam(' session-1 ')).toBe('session-1');
    expect(normalizeGameSessionIdParam('\tsession-2\n')).toBe('session-2');
  });

  it('空文字と空白のみの値は null を返す', () => {
    expect(normalizeGameSessionIdParam('')).toBeNull();
    expect(normalizeGameSessionIdParam('   ')).toBeNull();
  });

  it('null と undefined は null を返す', () => {
    expect(normalizeGameSessionIdParam(null)).toBeNull();
    expect(normalizeGameSessionIdParam(undefined)).toBeNull();
  });

  it('trim 済みの sessionId はそのまま返す', () => {
    expect(normalizeGameSessionIdParam('session-1')).toBe('session-1');
  });
});
