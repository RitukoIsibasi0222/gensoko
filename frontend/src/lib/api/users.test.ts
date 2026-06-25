import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';

vi.mock('$lib/api/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api/v1'
}));

const { getMyStats } = await import('./users');

const VALID_STATS_RESPONSE = {
  stats: {
    totalGames: 12,
    totalCorrect: 91,
    totalAnswered: 120,
    averageAccuracyRate: 76,
    masteredCount: 18,
    currentStreak: 5,
    weeklyScore: 2400,
    allTimeScore: 9200,
    lastActiveDate: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T12:35:00.000Z'
  },
  recentAccuracyTrend: [
    {
      sessionId: 'session-1',
      playedAt: '2026-06-20T12:35:00.000Z',
      correctCount: 8,
      totalCount: 10,
      accuracyRate: 80
    }
  ]
};

describe('getMyStats', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: Authorization を付けて統計情報を返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_STATS_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await getMyStats({ accessToken: 'test-access-token' });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/users/me/stats', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token'
      }
    });
    expect(result).toEqual(VALID_STATS_RESPONSE);
  });

  it('正常系: AbortSignal を fetch に渡す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_STATS_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const controller = new AbortController();

    await getMyStats({ accessToken: 'test-access-token', signal: controller.signal });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/users/me/stats', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token'
      },
      signal: controller.signal
    });
  });

  it('HTTPエラー: レスポンスの日本語 error を ApiError に保持する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: '認証が必要です' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(getMyStats({ accessToken: 'test-access-token' })).rejects.toThrow(
      '認証が必要です'
    );
  });

  it('HTTPエラー: 非 JSON レスポンスの場合はデフォルトメッセージを使う', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      })
    );

    await expect(getMyStats({ accessToken: 'test-access-token' })).rejects.toThrow(
      '統計情報の取得に失敗しました'
    );
  });

  it('レスポンス形式不正: 200 OK でも JSON パースに失敗した場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{ invalid json', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getMyStats({ accessToken: 'test-access-token' });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('統計情報のレスポンス形式が不正です');
      expect((error as ApiError).body).toBeNull();
    }
  });

  it('レスポンス形式不正: stats がない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ recentAccuracyTrend: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getMyStats({ accessToken: 'test-access-token' });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('統計情報のレスポンス形式が不正です');
    }
  });

  it('レスポンス形式不正: null 許可日付以外が不正なら ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...VALID_STATS_RESPONSE,
          stats: {
            ...VALID_STATS_RESPONSE.stats,
            lastActiveDate: 'invalid-date'
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    await expect(getMyStats({ accessToken: 'test-access-token' })).rejects.toThrow(
      '統計情報のレスポンス形式が不正です'
    );
  });

  it('レスポンス形式不正: 正答率が 0 から 100 の整数でなければ ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...VALID_STATS_RESPONSE,
          recentAccuracyTrend: [
            {
              ...VALID_STATS_RESPONSE.recentAccuracyTrend[0],
              accuracyRate: 120
            }
          ]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    await expect(getMyStats({ accessToken: 'test-access-token' })).rejects.toThrow(
      '統計情報のレスポンス形式が不正です'
    );
  });

  it('レスポンス形式不正: 累計正解数が累計回答数を超える場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...VALID_STATS_RESPONSE,
          stats: {
            ...VALID_STATS_RESPONSE.stats,
            totalCorrect: 121,
            totalAnswered: 120
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    await expect(getMyStats({ accessToken: 'test-access-token' })).rejects.toThrow(
      '統計情報のレスポンス形式が不正です'
    );
  });

  it('レスポンス形式不正: ゲーム単位の正解数が問題数を超える場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...VALID_STATS_RESPONSE,
          recentAccuracyTrend: [
            {
              ...VALID_STATS_RESPONSE.recentAccuracyTrend[0],
              correctCount: 11,
              totalCount: 10
            }
          ]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    await expect(getMyStats({ accessToken: 'test-access-token' })).rejects.toThrow(
      '統計情報のレスポンス形式が不正です'
    );
  });
});
