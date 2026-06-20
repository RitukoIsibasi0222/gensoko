import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';

vi.mock('$lib/api/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api/v1'
}));

const { getGameQuestions } = await import('./game');

const VALID_RESPONSE = {
  questionSetId: 'question-set-1',
  expiresAt: '2026-06-20T12:30:00.000Z',
  questions: [
    {
      questionId: 'q1',
      prompt: 'H',
      choices: [
        { choiceId: '1', text: '水素' },
        { choiceId: '6', text: '炭素' },
        { choiceId: '8', text: '酸素' },
        { choiceId: '7', text: '窒素' }
      ]
    }
  ]
};

describe('getGameQuestions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: mode query と Authorization を付けて問題セットを返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await getGameQuestions({
      mode: 'SYMBOL_TO_NAME_LV1',
      accessToken: 'test-access-token'
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/game/questions?mode=SYMBOL_TO_NAME_LV1',
      {
        method: 'GET',
        credentials: 'include',
        headers: {
          Authorization: 'Bearer test-access-token'
        }
      }
    );
    expect(result).toEqual(VALID_RESPONSE);
  });

  it('正常系: AbortSignal を fetch に渡す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const controller = new AbortController();

    await getGameQuestions({
      mode: 'NAME_TO_SYMBOL_LV1',
      accessToken: 'test-access-token',
      signal: controller.signal
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/game/questions?mode=NAME_TO_SYMBOL_LV1',
      {
        method: 'GET',
        credentials: 'include',
        headers: {
          Authorization: 'Bearer test-access-token'
        },
        signal: controller.signal
      }
    );
  });

  it('HTTPエラー: レスポンスの日本語 error を ApiError に保持する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: '認証が必要です' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      getGameQuestions({
        mode: 'SYMBOL_TO_NAME_LV1',
        accessToken: 'test-access-token'
      })
    ).rejects.toThrow('認証が必要です');
  });

  it('HTTPエラー: 非 JSON レスポンスの場合はデフォルトメッセージを使う', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      })
    );

    await expect(
      getGameQuestions({
        mode: 'SYMBOL_TO_NAME_LV1',
        accessToken: 'test-access-token'
      })
    ).rejects.toThrow('ゲーム問題の取得に失敗しました');
  });

  it('レスポンス形式不正: questionSetId がない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ questions: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getGameQuestions({
        mode: 'SYMBOL_TO_NAME_LV1',
        accessToken: 'test-access-token'
      });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('ゲーム問題のレスポンス形式が不正です');
    }
  });

  it('レスポンス形式不正: 公開 choices に elementId が含まれる場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...VALID_RESPONSE,
          questions: [
            {
              questionId: 'q1',
              prompt: 'H',
              choices: [{ choiceId: '1', elementId: 1, text: '水素' }]
            }
          ]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    await expect(
      getGameQuestions({
        mode: 'SYMBOL_TO_NAME_LV1',
        accessToken: 'test-access-token'
      })
    ).rejects.toThrow('ゲーム問題のレスポンス形式が不正です');
  });
});
