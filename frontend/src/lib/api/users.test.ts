import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';

vi.mock('$lib/api/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api/v1'
}));

const {
  changeCurrentPassword,
  deleteCurrentUser,
  getCurrentUserProfile,
  getMyStats,
  updateCurrentUsername
} = await import('./users');

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

const VALID_PROFILE_RESPONSE = {
  user: {
    id: 'user-1',
    username: 'taro123',
    email: 'taro@example.com',
    role: 'USER',
    createdAt: '2026-05-01T00:00:00.000Z'
  }
};

const VALID_UPDATE_USERNAME_RESPONSE = {
  message: 'ユーザー名を変更しました',
  user: {
    id: 'user-1',
    username: 'new_name_123',
    role: 'USER'
  }
};

describe('getCurrentUserProfile', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: Authorization と AbortSignal を付けてプロフィールを返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_PROFILE_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const controller = new AbortController();

    const result = await getCurrentUserProfile({
      accessToken: 'test-access-token',
      signal: controller.signal
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/users/me', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token'
      },
      signal: controller.signal
    });
    expect(result).toEqual(VALID_PROFILE_RESPONSE.user);
  });

  it('HTTPエラー: レスポンスの日本語 error を ApiError に保持する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: '認証が必要です' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(getCurrentUserProfile({ accessToken: 'test-access-token' })).rejects.toThrow(
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

    await expect(getCurrentUserProfile({ accessToken: 'test-access-token' })).rejects.toThrow(
      'プロフィール情報の取得に失敗しました'
    );
  });

  it('レスポンス形式不正: user がない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getCurrentUserProfile({ accessToken: 'test-access-token' });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('プロフィール情報のレスポンス形式が不正です');
    }
  });

  it('レスポンス形式不正: 200 OK でも JSON パースに失敗した場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('OK', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })
    );

    try {
      await getCurrentUserProfile({ accessToken: 'test-access-token' });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('プロフィール情報のレスポンス形式が不正です');
      expect((error as ApiError).body).toBeNull();
    }
  });
});

describe('updateCurrentUsername', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: ユーザー名変更 payload を送信して更新後ユーザーを返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_UPDATE_USERNAME_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await updateCurrentUsername({
      accessToken: 'test-access-token',
      username: 'new_name_123'
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/users/me', {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username: 'new_name_123' })
    });
    expect(result).toEqual(VALID_UPDATE_USERNAME_RESPONSE);
  });

  it('HTTPエラー: 409 の日本語 error と status/body を ApiError に保持する', async () => {
    const errorBody = { error: 'このユーザー名は既に使用されています' };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(errorBody), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await updateCurrentUsername({
        accessToken: 'test-access-token',
        username: 'duplicated_name'
      });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).message).toBe('このユーザー名は既に使用されています');
      expect((error as ApiError).body).toEqual(errorBody);
    }
  });

  it('レスポンス形式不正: updated user がない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'ユーザー名を変更しました' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      updateCurrentUsername({ accessToken: 'test-access-token', username: 'new_name_123' })
    ).rejects.toThrow('ユーザー名変更のレスポンス形式が不正です');
  });
});

describe('changeCurrentPassword', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: パスワード変更 payload を送信して message を返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'パスワードを変更しました' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await changeCurrentPassword({
      accessToken: 'test-access-token',
      currentPassword: 'OldPass1!',
      newPassword: 'NewPass1!'
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/users/me', {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ currentPassword: 'OldPass1!', newPassword: 'NewPass1!' })
    });
    expect(result).toEqual({ message: 'パスワードを変更しました' });
  });

  it('HTTPエラー: 非 JSON レスポンスの場合はデフォルトメッセージを使う', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      })
    );

    await expect(
      changeCurrentPassword({
        accessToken: 'test-access-token',
        currentPassword: 'OldPass1!',
        newPassword: 'NewPass1!'
      })
    ).rejects.toThrow('パスワード変更に失敗しました');
  });

  it('HTTPエラー: 429 の日本語 error と status/body を ApiError に保持する', async () => {
    const errorBody = { error: 'リクエストが多すぎます。しばらく待ってから再試行してください' };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(errorBody), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await changeCurrentPassword({
        accessToken: 'test-access-token',
        currentPassword: 'OldPass1!',
        newPassword: 'NewPass1!'
      });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(429);
      expect((error as ApiError).message).toBe(
        'リクエストが多すぎます。しばらく待ってから再試行してください'
      );
      expect((error as ApiError).body).toEqual(errorBody);
    }
  });

  it('レスポンス形式不正: message がない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      changeCurrentPassword({
        accessToken: 'test-access-token',
        currentPassword: 'OldPass1!',
        newPassword: 'NewPass1!'
      })
    ).rejects.toThrow('パスワード変更のレスポンス形式が不正です');
  });
});

describe('deleteCurrentUser', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: アカウント削除 payload を送信して message を返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'アカウントを削除しました' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await deleteCurrentUser({
      accessToken: 'test-access-token',
      currentPassword: 'Pass1234!'
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/users/me', {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ currentPassword: 'Pass1234!' })
    });
    expect(result).toEqual({ message: 'アカウントを削除しました' });
  });

  it('HTTPエラー: 日本語 error を ApiError に保持する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: '現在のパスワードが正しくありません' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      deleteCurrentUser({ accessToken: 'test-access-token', currentPassword: 'WrongPass1!' })
    ).rejects.toThrow('現在のパスワードが正しくありません');
  });

  it('HTTPエラー: details の先頭メッセージを error より優先し、status/body を保持する', async () => {
    const errorBody = {
      error: 'バリデーションエラー',
      details: [{ message: '現在のパスワードを入力してください' }]
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(errorBody), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await deleteCurrentUser({ accessToken: 'test-access-token', currentPassword: '' });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).message).toBe('現在のパスワードを入力してください');
      expect((error as ApiError).body).toEqual(errorBody);
    }
  });

  it('レスポンス形式不正: message がない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      deleteCurrentUser({ accessToken: 'test-access-token', currentPassword: 'Pass1234!' })
    ).rejects.toThrow('アカウント削除のレスポンス形式が不正です');
  });
});
