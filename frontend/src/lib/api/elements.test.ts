import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from './errors';

vi.mock('$lib/api/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api/v1'
}));

const { getElements } = await import('./elements');

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

  it('fetch 拒否: ネットワークエラーでそのまま throw される', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getElements()).rejects.toThrow('Failed to fetch');
  });
});
