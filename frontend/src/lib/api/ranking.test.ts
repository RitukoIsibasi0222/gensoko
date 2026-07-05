import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';

vi.mock('$lib/api/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api/v1'
}));

const { getRanking } = await import('./ranking');

const WEEKLY_RESPONSE = {
  ranking: [{ rank: 1, username: 'taro', weeklyScore: 15000, totalGames: 30, accuracyRate: 86 }],
  myRank: null
};

const ALLTIME_RESPONSE = {
  ranking: [
    { rank: 1, username: 'hanako', allTimeScore: 92000, totalGames: 180, accuracyRate: 91 }
  ],
  myRank: 42
};

describe('getRanking', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('weekly は Authorization なしで /ranking/weekly を取得し、score に正規化する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(WEEKLY_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await getRanking({ period: 'weekly' });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/ranking/weekly', {
      method: 'GET',
      credentials: 'include'
    });
    expect(result).toEqual({
      period: 'weekly',
      ranking: [{ rank: 1, username: 'taro', score: 15000, totalGames: 30, accuracyRate: 86 }],
      myRank: null
    });
  });

  it('空白だけの accessToken では Authorization header を送らない', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(WEEKLY_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await getRanking({ period: 'weekly', accessToken: '   ' });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/ranking/weekly', {
      method: 'GET',
      credentials: 'include'
    });
  });

  it('alltime は Authorization と AbortSignal を付けて /ranking/alltime を取得する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(ALLTIME_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const controller = new AbortController();

    const result = await getRanking({
      period: 'alltime',
      accessToken: 'test-access-token',
      signal: controller.signal
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/ranking/alltime', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token'
      },
      signal: controller.signal
    });
    expect(result).toEqual({
      period: 'alltime',
      ranking: [{ rank: 1, username: 'hanako', score: 92000, totalGames: 180, accuracyRate: 91 }],
      myRank: 42
    });
  });

  it('HTTPエラー: JSON error を ApiError に保持する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'トークンが無効です' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(getRanking({ period: 'weekly', accessToken: 'bad-token' })).rejects.toThrow(
      'トークンが無効です'
    );
  });

  it('HTTPエラー: 非 JSON レスポンスの場合はデフォルトメッセージを使う', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      })
    );

    await expect(getRanking({ period: 'weekly' })).rejects.toThrow(
      'ランキングの取得に失敗しました'
    );
  });

  it('レスポンス形式不正: weeklyScore がない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ranking: [{ rank: 1, username: 'taro', totalGames: 30, accuracyRate: 86 }],
          myRank: null
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    try {
      await getRanking({ period: 'weekly' });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('ランキングのレスポンス形式が不正です');
    }
  });

  it('レスポンス形式不正: allTimeScore がない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ranking: [
            { rank: 1, username: 'hanako', weeklyScore: 92000, totalGames: 180, accuracyRate: 91 }
          ],
          myRank: 42
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    await expect(getRanking({ period: 'alltime' })).rejects.toThrow(
      'ランキングのレスポンス形式が不正です'
    );
  });

  it('レスポンス形式不正: 正答率が 0 から 100 の整数でなければ ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ranking: [
            { rank: 1, username: 'taro', weeklyScore: 15000, totalGames: 30, accuracyRate: 101 }
          ],
          myRank: null
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    await expect(getRanking({ period: 'weekly' })).rejects.toThrow(
      'ランキングのレスポンス形式が不正です'
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
      await getRanking({ period: 'weekly' });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).body).toBeNull();
    }
  });
});
