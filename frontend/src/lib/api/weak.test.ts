import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';

vi.mock('$lib/api/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api/v1'
}));

const { deleteWeakElement, getWeakElements } = await import('./weak');

const VALID_RESPONSE = {
  weakElements: [
    {
      elementId: 26,
      symbol: 'Fe',
      nameJa: '鉄',
      missCount: 3,
      addedAt: '2026-05-01T00:00:00.000Z'
    }
  ]
};

describe('getWeakElements', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: Authorization を付けて苦手リストを返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await getWeakElements({ accessToken: 'test-access-token' });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/weak', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token'
      }
    });
    expect(result).toEqual(VALID_RESPONSE.weakElements);
  });

  it('正常系: AbortSignal を fetch に渡す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const controller = new AbortController();

    await getWeakElements({
      accessToken: 'test-access-token',
      signal: controller.signal
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/weak', {
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

    await expect(getWeakElements({ accessToken: 'test-access-token' })).rejects.toThrow(
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

    await expect(getWeakElements({ accessToken: 'test-access-token' })).rejects.toThrow(
      '苦手リストの取得に失敗しました'
    );
  });

  it('レスポンス形式不正: weakElements がない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getWeakElements({ accessToken: 'test-access-token' });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('苦手リストのレスポンス形式が不正です');
    }
  });

  it('レスポンス形式不正: elementId が number でない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          weakElements: [
            {
              ...VALID_RESPONSE.weakElements[0],
              elementId: '26'
            }
          ]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    await expect(getWeakElements({ accessToken: 'test-access-token' })).rejects.toThrow(
      '苦手リストのレスポンス形式が不正です'
    );
  });
});

describe('deleteWeakElement', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: Authorization を付けて苦手元素を削除する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: '苦手リストから削除しました' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await deleteWeakElement({
      accessToken: 'test-access-token',
      elementId: 26
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/weak/26', {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token'
      }
    });
    expect(result).toEqual({ message: '苦手リストから削除しました' });
  });

  it('正常系: AbortSignal を fetch に渡す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: '苦手リストから削除しました' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const controller = new AbortController();

    await deleteWeakElement({
      accessToken: 'test-access-token',
      elementId: 8,
      signal: controller.signal
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/weak/8', {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token'
      },
      signal: controller.signal
    });
  });

  it('HTTPエラー: レスポンスの日本語 error を ApiError に保持する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: '苦手元素が見つかりません' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      deleteWeakElement({ accessToken: 'test-access-token', elementId: 26 })
    ).rejects.toThrow('苦手元素が見つかりません');
  });

  it('HTTPエラー: 非 JSON レスポンスの場合はデフォルトメッセージを使う', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      })
    );

    await expect(
      deleteWeakElement({ accessToken: 'test-access-token', elementId: 26 })
    ).rejects.toThrow('苦手元素の削除に失敗しました');
  });

  it('レスポンス形式不正: message がない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await deleteWeakElement({ accessToken: 'test-access-token', elementId: 26 });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('苦手元素削除のレスポンス形式が不正です');
    }
  });
});
