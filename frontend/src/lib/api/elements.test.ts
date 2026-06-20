import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from './errors';

vi.mock('$lib/api/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api/v1'
}));

const { getElement, getElements } = await import('./elements');

const VALID_ELEMENT = {
  id: 1,
  symbol: 'H',
  nameJa: '水素',
  nameEn: 'Hydrogen',
  category: '非金属',
  period: 1,
  group: 1,
  atomicWeight: 1.008,
  etymology: null
};

const VALID_ELEMENT_WITH_MASTERY = {
  ...VALID_ELEMENT,
  masteryStatus: 'mastered'
};

describe('getElements', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: elements 配列を返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ elements: [VALID_ELEMENT] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await getElements();
    expect(result).toEqual([VALID_ELEMENT]);
  });

  it('正常系: accessToken なしでは Authorization ヘッダーを送らない', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ elements: [VALID_ELEMENT] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await getElements();

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/elements', {
      method: 'GET',
      credentials: 'include'
    });
  });

  it('正常系: accessToken がある場合は Authorization ヘッダーを送る', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ elements: [VALID_ELEMENT_WITH_MASTERY] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await getElements({ accessToken: 'test-access-token' });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/elements', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token'
      }
    });
    expect(result).toEqual([VALID_ELEMENT_WITH_MASTERY]);
  });

  it('正常系: filters がある場合は query string を付ける', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ elements: [VALID_ELEMENT] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await getElements({
      filters: {
        q: '  H  ',
        category: '非金属',
        period: '1'
      }
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/elements?q=H&category=%E9%9D%9E%E9%87%91%E5%B1%9E&period=1',
      {
        method: 'GET',
        credentials: 'include'
      }
    );
  });

  it('正常系: 空の filters は query string に含めない', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ elements: [VALID_ELEMENT] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await getElements({
      filters: {
        q: '   ',
        category: '',
        period: null
      }
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/elements', {
      method: 'GET',
      credentials: 'include'
    });
  });

  it('正常系: accessToken と filters を同時に反映する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ elements: [VALID_ELEMENT_WITH_MASTERY] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await getElements({
      accessToken: 'test-access-token',
      filters: {
        q: '水素',
        category: '',
        period: 1
      }
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/elements?q=%E6%B0%B4%E7%B4%A0&period=1',
      {
        method: 'GET',
        credentials: 'include',
        headers: {
          Authorization: 'Bearer test-access-token'
        }
      }
    );
  });

  it('正常系: AbortSignal を fetch に渡す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ elements: [VALID_ELEMENT] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const controller = new AbortController();

    await getElements({ signal: controller.signal });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/elements', {
      method: 'GET',
      credentials: 'include',
      signal: controller.signal
    });
  });

  it('正常系: masteryStatus が learning の要素を返す', async () => {
    const element = { ...VALID_ELEMENT, masteryStatus: 'learning' };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ elements: [element] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await getElements();

    expect(result).toEqual([element]);
  });

  it('正常系: 空配列のレスポンスも正常に返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ elements: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await getElements();
    expect(result).toEqual([]);
  });

  it('HTTPエラー: ApiError が throw される', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: '認証が必要です' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(getElements()).rejects.toBeInstanceOf(ApiError);
  });

  it('HTTPエラー: ApiError の status が response.status と一致する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'サーバーエラー' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getElements();
      expect.fail('ApiError が throw されるべき');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(500);
    }
  });

  it('HTTPエラー: エラーメッセージがレスポンスの error フィールドから取得される', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: '元素一覧の取得に失敗しました' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(getElements()).rejects.toThrow('元素一覧の取得に失敗しました');
  });

  it('HTTPエラー: 非JSONレスポンスの場合はデフォルトメッセージが使われる', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Internal Server Error', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      })
    );

    await expect(getElements()).rejects.toThrow('元素一覧の取得に失敗しました');
  });

  it('レスポンス形式不正: elements フィールドがない場合は ApiError(500) が throw される', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getElements();
      expect.fail('ApiError が throw されるべき');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(500);
      expect((e as ApiError).message).toBe('元素一覧のレスポンス形式が不正です');
    }
  });

  it('レスポンス形式不正: elements 内に必須フィールドが欠けた要素がある場合は ApiError(500) が throw される', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ elements: [{ id: 1, symbol: 'H' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getElements();
      expect.fail('ApiError が throw されるべき');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(500);
    }
  });

  it('レスポンス形式不正: masteryStatus が未知の値の場合は ApiError(500) が throw される', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ elements: [{ ...VALID_ELEMENT, masteryStatus: 'unknown' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getElements();
      expect.fail('ApiError が throw されるべき');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(500);
      expect((e as ApiError).message).toBe('元素一覧のレスポンス形式が不正です');
    }
  });

  it('正常系: 未知の category も query string に含める', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ elements: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await getElements({
      filters: {
        q: '',
        category: 'UNKNOWN_CATEGORY',
        period: null
      }
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/elements?category=UNKNOWN_CATEGORY',
      {
        method: 'GET',
        credentials: 'include'
      }
    );
  });

  it('fetch 拒否: ネットワークエラーでそのまま throw される', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getElements()).rejects.toThrow('Failed to fetch');
  });
});

describe('getElement', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: element を返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ element: VALID_ELEMENT }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await getElement(1);

    expect(result).toEqual(VALID_ELEMENT);
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/elements/1', {
      method: 'GET',
      credentials: 'include'
    });
  });

  it('正常系: AbortSignal を fetch に渡す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ element: VALID_ELEMENT }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const controller = new AbortController();

    await getElement(1, { signal: controller.signal });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/elements/1', {
      method: 'GET',
      credentials: 'include',
      signal: controller.signal
    });
  });

  it('HTTPエラー: ApiError が throw される', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: '元素が見つかりません' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getElement(118);
      expect.fail('ApiError が throw されるべき');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(404);
      expect((e as ApiError).message).toBe('元素が見つかりません');
    }
  });

  it('HTTPエラー: 非JSONレスポンスの場合はデフォルトメッセージが使われる', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      })
    );

    await expect(getElement(1)).rejects.toThrow('元素詳細の取得に失敗しました');
  });

  it('レスポンス形式不正: element フィールドがない場合は ApiError(500) が throw される', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: VALID_ELEMENT }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getElement(1);
      expect.fail('ApiError が throw されるべき');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(500);
      expect((e as ApiError).message).toBe('元素詳細のレスポンス形式が不正です');
    }
  });

  it('レスポンス形式不正: element の必須フィールドが欠けている場合は ApiError(500) が throw される', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ element: { id: 1, symbol: 'H' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getElement(1);
      expect.fail('ApiError が throw されるべき');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(500);
      expect((e as ApiError).message).toBe('元素詳細のレスポンス形式が不正です');
    }
  });

  it('fetch 拒否: ネットワークエラーでそのまま throw される', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getElement(1)).rejects.toThrow('Failed to fetch');
  });
});
