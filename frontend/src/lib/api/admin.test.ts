import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';

vi.mock('$lib/api/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api/v1'
}));

const {
  deleteAdminUser,
  getAdminStats,
  getAdminUserDetail,
  getAdminUsers,
  updateAdminUserRole,
  updateAdminUserStatus
} = await import('./admin');

const VALID_USER_SUMMARY = {
  id: 'user-1',
  username: 'taro',
  email: 'taro@example.com',
  role: 'USER' as const,
  emailVerified: true,
  isActive: true,
  deletedAt: null,
  lockedUntil: null,
  lastLoginAt: '2026-07-10T10:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-10T10:00:00.000Z'
};

const VALID_LIST_RESPONSE = {
  users: [
    {
      ...VALID_USER_SUMMARY,
      stats: {
        totalGames: 12,
        accuracyRate: 75,
        weeklyScore: 2400,
        allTimeScore: 9200
      }
    }
  ],
  nextCursor: 'user-1'
};

const VALID_DETAIL_RESPONSE = {
  user: {
    ...VALID_USER_SUMMARY,
    loginFailCount: 0,
    stats: {
      totalGames: 12,
      totalCorrect: 91,
      totalAnswered: 120,
      accuracyRate: 76,
      masteredCount: 18,
      currentStreak: 5,
      weeklyScore: 2400,
      allTimeScore: 9200,
      lastActiveDate: '2026-07-10T00:00:00.000Z',
      updatedAt: '2026-07-10T10:00:00.000Z'
    }
  }
};

const VALID_STATS_RESPONSE = {
  users: {
    total: 30,
    active: 24,
    suspended: 3,
    deleted: 3,
    admins: 2,
    emailVerified: 25
  },
  games: {
    totalSessions: 140,
    totalAnswered: 1400,
    averageAccuracyRate: 78
  },
  learning: {
    totalWeakElements: 45,
    totalMasteredCount: 210
  }
};

const VALID_MUTATION_RESPONSE = {
  message: 'アカウントを停止しました',
  user: {
    ...VALID_USER_SUMMARY,
    isActive: false
  }
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getAdminUsers', () => {
  it('query未指定: 認証情報だけを付け、不要なクエリ文字列を送らない', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(VALID_LIST_RESPONSE));

    await getAdminUsers({ accessToken: 'test-access-token' });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/admin/users', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token'
      }
    });
  });

  it('query指定: 正規化済みの検索語とcursor、limit、role、statusをURL encodeする', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(VALID_LIST_RESPONSE));

    await getAdminUsers({
      accessToken: 'test-access-token',
      query: {
        limit: 20,
        cursor: 'cursor/1',
        q: 'taro+admin@example.com',
        role: 'ADMIN',
        status: 'active'
      }
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/admin/users?limit=20&cursor=cursor%2F1&q=taro%2Badmin%40example.com&role=ADMIN&status=active',
      {
        method: 'GET',
        credentials: 'include',
        headers: {
          Authorization: 'Bearer test-access-token'
        }
      }
    );
  });

  it('空文字・undefinedはクエリへ含めない', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(VALID_LIST_RESPONSE));

    await getAdminUsers({
      accessToken: 'test-access-token',
      query: {
        cursor: '',
        q: '',
        role: undefined,
        status: undefined
      }
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/admin/users',
      expect.anything()
    );
  });

  it('limitの境界値1と100を送信できる', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(VALID_LIST_RESPONSE))
      .mockResolvedValueOnce(jsonResponse(VALID_LIST_RESPONSE));

    await getAdminUsers({ accessToken: 'token', query: { limit: 1 } });
    await getAdminUsers({ accessToken: 'token', query: { limit: 100 } });

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://localhost:3000/api/v1/admin/users?limit=1'
    );
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toBe(
      'http://localhost:3000/api/v1/admin/users?limit=100'
    );
  });

  it('AbortSignalをfetchへ渡す', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(VALID_LIST_RESPONSE));
    const controller = new AbortController();

    await getAdminUsers({ accessToken: 'token', signal: controller.signal });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/admin/users',
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('正常レスポンスを返す', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(VALID_LIST_RESPONSE));

    await expect(getAdminUsers({ accessToken: 'token' })).resolves.toEqual(VALID_LIST_RESPONSE);
  });

  it('UserStatsがない場合に相当する0値とnull日付を受理する', async () => {
    const response = {
      users: [
        {
          ...VALID_USER_SUMMARY,
          lastLoginAt: null,
          stats: {
            totalGames: 0,
            accuracyRate: 0,
            weeklyScore: 0,
            allTimeScore: 0
          }
        }
      ],
      nextCursor: null
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(response));

    await expect(getAdminUsers({ accessToken: 'token' })).resolves.toEqual(response);
  });

  it('ユーザーIDが重複する成功レスポンスをApiError(500)として拒否する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        users: [VALID_LIST_RESPONSE.users[0], { ...VALID_LIST_RESPONSE.users[0] }],
        nextCursor: null
      })
    );

    await expectInvalidResponse(getAdminUsers({ accessToken: 'token' }), 'ユーザー一覧');
  });

  it('空のnextCursorを成功レスポンスとして受理しない', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ...VALID_LIST_RESPONSE,
        nextCursor: ''
      })
    );

    await expectInvalidResponse(getAdminUsers({ accessToken: 'token' }), 'ユーザー一覧');
  });

  it.each([
    ['負数の件数', { totalGames: -1 }],
    ['小数の件数', { weeklyScore: 1.5 }],
    ['101の正答率', { accuracyRate: 101 }]
  ])('%sを含む成功レスポンスを拒否する', async (_name, invalidStats) => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ...VALID_LIST_RESPONSE,
        users: [
          {
            ...VALID_LIST_RESPONSE.users[0],
            stats: {
              ...VALID_LIST_RESPONSE.users[0].stats,
              ...invalidStats
            }
          }
        ]
      })
    );

    await expectInvalidResponse(getAdminUsers({ accessToken: 'token' }), 'ユーザー一覧');
  });

  it.each([
    ['不正なrole', { role: 'OWNER' }],
    ['不正な日付', { createdAt: 'not-a-date' }]
  ])('%sを含む成功レスポンスを拒否する', async (_name, invalidUser) => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ...VALID_LIST_RESPONSE,
        users: [{ ...VALID_LIST_RESPONSE.users[0], ...invalidUser }]
      })
    );

    await expectInvalidResponse(getAdminUsers({ accessToken: 'token' }), 'ユーザー一覧');
  });

  it('HTTPエラーのdetails先頭メッセージとstatus/bodyを保持する', async () => {
    const body = {
      error: 'バリデーションエラー',
      details: [{ message: '検索キーワードが正しくありません' }]
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(body, 400));

    try {
      await getAdminUsers({ accessToken: 'token' });
      expect.fail('ApiErrorがthrowされるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
      expect((error as ApiError).message).toBe('検索キーワードが正しくありません');
      expect((error as ApiError).body).toEqual(body);
    }
  });

  it('非JSONのHTTPエラーではbodyをnullにする', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      })
    );

    try {
      await getAdminUsers({ accessToken: 'token' });
      expect.fail('ApiErrorがthrowされるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(502);
      expect((error as ApiError).body).toBeNull();
    }
  });

  it('200でも非JSONならApiError(500)として拒否する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('OK', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      })
    );

    await expectInvalidResponse(getAdminUsers({ accessToken: 'token' }), 'ユーザー一覧');
  });

  it('network errorはpage側で接続エラーへ変換できるよう、そのままrejectする', async () => {
    const networkError = new TypeError('Failed to fetch');
    vi.mocked(fetch).mockRejectedValue(networkError);

    await expect(getAdminUsers({ accessToken: 'token' })).rejects.toBe(networkError);
  });
});

describe('getAdminUserDetail', () => {
  it('ユーザーIDをURL encodeし、詳細を返す', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(VALID_DETAIL_RESPONSE));

    await expect(getAdminUserDetail({ accessToken: 'token', userId: 'user/1' })).resolves.toEqual(
      VALID_DETAIL_RESPONSE
    );

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/admin/users/user%2F1', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer token'
      }
    });
  });

  it('文書にない大小制約を追加せずtotalCorrectがtotalAnsweredを超えても受理する', async () => {
    const response = {
      user: {
        ...VALID_DETAIL_RESPONSE.user,
        stats: {
          ...VALID_DETAIL_RESPONSE.user.stats,
          totalCorrect: 121,
          totalAnswered: 120
        }
      }
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(response));

    await expect(getAdminUserDetail({ accessToken: 'token', userId: 'user-1' })).resolves.toEqual(
      response
    );
  });

  it.each([
    ['負数のloginFailCount', { loginFailCount: -1 }],
    ['不正なnullable日付', { lockedUntil: 'invalid-date' }]
  ])('%sを含む成功レスポンスを拒否する', async (_name, invalidUser) => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        user: {
          ...VALID_DETAIL_RESPONSE.user,
          ...invalidUser
        }
      })
    );

    await expectInvalidResponse(
      getAdminUserDetail({ accessToken: 'token', userId: 'user-1' }),
      'ユーザー詳細'
    );
  });
});

describe('getAdminStats', () => {
  it('認証情報を付けて統計を返す', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(VALID_STATS_RESPONSE));

    await expect(getAdminStats({ accessToken: 'token' })).resolves.toEqual(VALID_STATS_RESPONSE);
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/admin/stats', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer token'
      }
    });
  });

  it.each([
    ['負数の件数', { users: { ...VALID_STATS_RESPONSE.users, total: -1 } }],
    [
      '小数の件数',
      {
        learning: {
          ...VALID_STATS_RESPONSE.learning,
          totalMasteredCount: 1.5
        }
      }
    ],
    [
      '101の平均正答率',
      {
        games: {
          ...VALID_STATS_RESPONSE.games,
          averageAccuracyRate: 101
        }
      }
    ]
  ])('%sを含む成功レスポンスを拒否する', async (_name, invalidSection) => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ...VALID_STATS_RESPONSE,
        ...invalidSection
      })
    );

    await expectInvalidResponse(getAdminStats({ accessToken: 'token' }), '管理者統計');
  });
});

describe('管理者mutation', () => {
  it('停止・解除: PATCHとJSON bodyを送信し、更新ユーザーを返す', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(VALID_MUTATION_RESPONSE));

    await expect(
      updateAdminUserStatus({
        accessToken: 'token',
        userId: 'user-1',
        isActive: false
      })
    ).resolves.toEqual(VALID_MUTATION_RESPONSE);

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/admin/users/user-1/status', {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ isActive: false })
    });
  });

  it('ロール変更: PATCHとJSON bodyを送信する', async () => {
    const response = {
      message: 'ロールを変更しました',
      user: {
        ...VALID_USER_SUMMARY,
        role: 'ADMIN' as const
      }
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(response));
    const controller = new AbortController();

    await updateAdminUserRole({
      accessToken: 'token',
      userId: 'user-1',
      role: 'ADMIN',
      signal: controller.signal
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/admin/users/user-1/role', {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: 'ADMIN' }),
      signal: controller.signal
    });
  });

  it('強制退会: DELETEで不要なbodyとContent-Typeを送らない', async () => {
    const response = { message: 'ユーザーを強制退会しました' };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(response));

    await expect(deleteAdminUser({ accessToken: 'token', userId: 'user-1' })).resolves.toEqual(
      response
    );

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/admin/users/user-1', {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer token'
      }
    });
  });

  it('更新レスポンスにuserがなければ拒否する', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: 'ロールを変更しました' }));

    await expectInvalidResponse(
      updateAdminUserRole({
        accessToken: 'token',
        userId: 'user-1',
        role: 'ADMIN'
      }),
      'ロール変更'
    );
  });

  it('削除レスポンスにmessageがなければ拒否する', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}));

    await expectInvalidResponse(
      deleteAdminUser({ accessToken: 'token', userId: 'user-1' }),
      '強制退会'
    );
  });

  it('空または契約外の成功messageを拒否する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ...VALID_MUTATION_RESPONSE,
        message: ''
      })
    );

    await expectInvalidResponse(
      updateAdminUserStatus({
        accessToken: 'token',
        userId: 'user-1',
        isActive: false
      }),
      'アカウント状態変更'
    );

    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: '削除しました' }));
    await expectInvalidResponse(
      deleteAdminUser({ accessToken: 'token', userId: 'user-1' }),
      '強制退会'
    );
  });

  it('requestと矛盾する更新ユーザー状態を拒否する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ...VALID_MUTATION_RESPONSE,
        user: { ...VALID_MUTATION_RESPONSE.user, isActive: true }
      })
    );

    await expectInvalidResponse(
      updateAdminUserStatus({
        accessToken: 'token',
        userId: 'user-1',
        isActive: false
      }),
      'アカウント状態変更'
    );
  });

  it.each([401, 403, 404, 409, 500])(
    'HTTP %iの具体的な日本語メッセージを保持する',
    async (status) => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ error: '操作を完了できませんでした' }, status)
      );

      try {
        await updateAdminUserStatus({
          accessToken: 'token',
          userId: 'user-1',
          isActive: false
        });
        expect.fail('ApiErrorがthrowされるべき');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(status);
        expect((error as ApiError).message).toBe('操作を完了できませんでした');
      }
    }
  );
});

async function expectInvalidResponse(
  promise: Promise<unknown>,
  resourceName: string
): Promise<void> {
  try {
    await promise;
    expect.fail('ApiErrorがthrowされるべき');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(500);
    expect((error as ApiError).message).toContain(resourceName);
  }
}
