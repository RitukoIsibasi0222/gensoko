import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';

vi.mock('$lib/api/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api/v1'
}));

const { getGameQuestions, getGameSession, submitGameSession } = await import('./game');

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

const VALID_SESSION_RESPONSE = {
  sessionId: 'session-1',
  mode: 'SYMBOL_TO_NAME_LV1',
  totalCount: 2,
  correctCount: 1,
  totalScore: 100,
  maxStreak: 1,
  durationSec: 22,
  playedAt: '2026-06-20T12:35:00.000Z',
  results: [
    {
      questionId: 'q1',
      elementId: 1,
      prompt: 'H',
      chosenChoiceId: '1',
      isCorrect: true,
      correctAnswer: '水素',
      yourAnswer: '水素',
      answerTimeSec: 4,
      score: 100
    },
    {
      questionId: 'q2',
      elementId: 8,
      prompt: 'O',
      chosenChoiceId: null,
      isCorrect: false,
      correctAnswer: '酸素',
      yourAnswer: null,
      answerTimeSec: 15,
      score: 0
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

  it('レスポンス形式不正: 公開 choices に correctChoiceId が含まれる場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...VALID_RESPONSE,
          questions: [
            {
              questionId: 'q1',
              prompt: 'H',
              choices: [{ choiceId: '1', correctChoiceId: '1', text: '水素' }]
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

describe('submitGameSession', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: POST /game/sessions に Authorization と回答だけを送って結果を返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_SESSION_RESPONSE), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await submitGameSession({
      questionSetId: 'question-set-1',
      mode: 'SYMBOL_TO_NAME_LV1',
      accessToken: 'test-access-token',
      durationSec: 22,
      answers: [
        {
          questionId: 'q1',
          chosenChoiceId: '1',
          answerTimeSec: 4
        },
        {
          questionId: 'q2',
          chosenChoiceId: null,
          answerTimeSec: 15
        }
      ]
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/game/sessions', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        questionSetId: 'question-set-1',
        mode: 'SYMBOL_TO_NAME_LV1',
        answers: [
          {
            questionId: 'q1',
            chosenChoiceId: '1',
            answerTimeSec: 4
          },
          {
            questionId: 'q2',
            chosenChoiceId: null,
            answerTimeSec: 15
          }
        ],
        durationSec: 22
      })
    });
    expect(result).toEqual(VALID_SESSION_RESPONSE);
  });

  it('正常系: AbortSignal を fetch に渡す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_SESSION_RESPONSE), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const controller = new AbortController();

    await submitGameSession({
      questionSetId: 'question-set-1',
      mode: 'NAME_TO_SYMBOL_LV1',
      accessToken: 'test-access-token',
      durationSec: 4,
      answers: [
        {
          questionId: 'q1',
          chosenChoiceId: '1',
          answerTimeSec: 4
        }
      ],
      signal: controller.signal
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/game/sessions', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        questionSetId: 'question-set-1',
        mode: 'NAME_TO_SYMBOL_LV1',
        answers: [
          {
            questionId: 'q1',
            chosenChoiceId: '1',
            answerTimeSec: 4
          }
        ],
        durationSec: 4
      }),
      signal: controller.signal
    });
  });

  it('HTTPエラー: レスポンスの日本語 error を ApiError に保持する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: '問題セットの有効期限が切れています' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      submitGameSession({
        questionSetId: 'question-set-1',
        mode: 'SYMBOL_TO_NAME_LV1',
        accessToken: 'test-access-token',
        durationSec: 4,
        answers: [
          {
            questionId: 'q1',
            chosenChoiceId: '1',
            answerTimeSec: 4
          }
        ]
      })
    ).rejects.toThrow('問題セットの有効期限が切れています');
  });

  it('レート制限: 429 JSONのstatus・日本語message・bodyを保持する', async () => {
    const body = {
      error: 'リクエストが多すぎます。しばらく待ってから再試行してください'
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await submitGameSession({
        questionSetId: 'question-set-1',
        mode: 'SYMBOL_TO_NAME_LV1',
        accessToken: 'test-access-token',
        durationSec: 4,
        answers: [{ questionId: 'q1', chosenChoiceId: '1', answerTimeSec: 4 }]
      });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(429);
      expect((error as ApiError).message).toBe(body.error);
      expect((error as ApiError).body).toEqual(body);
    }
  });

  it('レート制限store障害: 503 JSONのstatus・日本語message・bodyを保持する', async () => {
    const body = {
      error: '一時的に利用できません。しばらく待ってから再試行してください'
    };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await submitGameSession({
        questionSetId: 'question-set-1',
        mode: 'SYMBOL_TO_NAME_LV1',
        accessToken: 'test-access-token',
        durationSec: 4,
        answers: [{ questionId: 'q1', chosenChoiceId: '1', answerTimeSec: 4 }]
      });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(503);
      expect((error as ApiError).message).toBe(body.error);
      expect((error as ApiError).body).toEqual(body);
    }
  });

  it('レート制限: 非JSONの429はゲーム送信用fallbackとbody=nullを保持する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Too Many Requests', {
        status: 429,
        headers: { 'Content-Type': 'text/plain' }
      })
    );

    try {
      await submitGameSession({
        questionSetId: 'question-set-1',
        mode: 'SYMBOL_TO_NAME_LV1',
        accessToken: 'test-access-token',
        durationSec: 4,
        answers: [{ questionId: 'q1', chosenChoiceId: '1', answerTimeSec: 4 }]
      });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(429);
      expect((error as ApiError).message).toBe('ゲーム結果の送信に失敗しました');
      expect((error as ApiError).body).toBeNull();
    }
  });

  it('ネットワークエラー: fetchの拒否理由を上位の画面処理へ伝播する', async () => {
    const networkError = new TypeError('Failed to fetch');
    vi.mocked(fetch).mockRejectedValue(networkError);

    await expect(
      submitGameSession({
        questionSetId: 'question-set-1',
        mode: 'SYMBOL_TO_NAME_LV1',
        accessToken: 'test-access-token',
        durationSec: 4,
        answers: [{ questionId: 'q1', chosenChoiceId: '1', answerTimeSec: 4 }]
      })
    ).rejects.toBe(networkError);
  });

  it('HTTPエラー: 非 JSON レスポンスの場合はデフォルトメッセージを使う', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      })
    );

    await expect(
      submitGameSession({
        questionSetId: 'question-set-1',
        mode: 'SYMBOL_TO_NAME_LV1',
        accessToken: 'test-access-token',
        durationSec: 4,
        answers: [
          {
            questionId: 'q1',
            chosenChoiceId: '1',
            answerTimeSec: 4
          }
        ]
      })
    ).rejects.toThrow('ゲーム結果の送信に失敗しました');
  });

  it('レスポンス形式不正: sessionId がない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ...VALID_SESSION_RESPONSE, sessionId: undefined }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await submitGameSession({
        questionSetId: 'question-set-1',
        mode: 'SYMBOL_TO_NAME_LV1',
        accessToken: 'test-access-token',
        durationSec: 4,
        answers: [
          {
            questionId: 'q1',
            chosenChoiceId: '1',
            answerTimeSec: 4
          }
        ]
      });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('ゲーム結果のレスポンス形式が不正です');
    }
  });
});

describe('getGameSession', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: encoded sessionId と Authorization を付けてゲーム結果を返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_SESSION_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const result = await getGameSession({
      sessionId: 'session id/1',
      accessToken: 'test-access-token'
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/game/sessions/session%20id%2F1',
      {
        method: 'GET',
        credentials: 'include',
        headers: {
          Authorization: 'Bearer test-access-token'
        }
      }
    );
    expect(result).toEqual(VALID_SESSION_RESPONSE);
  });

  it('正常系: AbortSignal を fetch に渡す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(VALID_SESSION_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const controller = new AbortController();

    await getGameSession({
      sessionId: 'session-1',
      accessToken: 'test-access-token',
      signal: controller.signal
    });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/game/sessions/session-1', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Authorization: 'Bearer test-access-token'
      },
      signal: controller.signal
    });
  });

  it('HTTPエラー: 401 の日本語 error を ApiError に保持する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: '認証が必要です' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      getGameSession({
        sessionId: 'session-1',
        accessToken: 'test-access-token'
      })
    ).rejects.toThrow('認証が必要です');
  });

  it('HTTPエラー: 404 の日本語 error を ApiError に保持する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'ゲーム結果が見つかりません' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      getGameSession({
        sessionId: 'missing-session',
        accessToken: 'test-access-token'
      })
    ).rejects.toThrow('ゲーム結果が見つかりません');
  });

  it('HTTPエラー: 非 JSON レスポンスの場合はデフォルトメッセージを使う', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      })
    );

    await expect(
      getGameSession({
        sessionId: 'session-1',
        accessToken: 'test-access-token'
      })
    ).rejects.toThrow('ゲーム結果の取得に失敗しました');
  });

  it('レスポンス形式不正: results がない場合は ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ...VALID_SESSION_RESPONSE, results: undefined }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    try {
      await getGameSession({
        sessionId: 'session-1',
        accessToken: 'test-access-token'
      });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('ゲーム結果のレスポンス形式が不正です');
    }
  });
});

describe('getGameSessions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const validSessionsResponse = {
    sessions: [
      {
        sessionId: 'session-1',
        mode: 'SYMBOL_TO_NAME_LV1',
        totalCount: 10,
        correctCount: 8,
        totalScore: 800,
        maxStreak: 5,
        durationSec: 72,
        playedAt: '2026-06-20T12:35:00.000Z'
      }
    ],
    nextCursor: 'session-next'
  };

  it('正常系: query と Authorization を付けて履歴一覧を返す', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(validSessionsResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const { getGameSessions } = await import('./game');

    const result = await getGameSessions({
      accessToken: 'test-access-token',
      limit: 10,
      cursor: 'session-cursor',
      mode: 'SYMBOL_TO_NAME_LV1'
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/game/sessions?limit=10&cursor=session-cursor&mode=SYMBOL_TO_NAME_LV1',
      {
        method: 'GET',
        credentials: 'include',
        headers: { Authorization: 'Bearer test-access-token' }
      }
    );
    expect(result).toEqual(validSessionsResponse);
  });

  it('正常系: null / undefined / 空文字 query は URL から省略する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ sessions: [], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const { getGameSessions } = await import('./game');

    await getGameSessions({ accessToken: 'test-access-token', cursor: '   ', mode: null });

    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/v1/game/sessions', {
      method: 'GET',
      credentials: 'include',
      headers: { Authorization: 'Bearer test-access-token' }
    });
  });

  it('HTTPエラー: 非 JSON レスポンスの場合はデフォルトメッセージを使う', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Bad Gateway', {
        status: 502,
        headers: { 'Content-Type': 'text/html' }
      })
    );
    const { getGameSessions } = await import('./game');

    await expect(getGameSessions({ accessToken: 'test-access-token' })).rejects.toThrow(
      'ゲーム履歴の取得に失敗しました'
    );
  });

  it('レスポンス形式不正: nextCursor が string|null でなければ ApiError(500) を throw する', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ sessions: [], nextCursor: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const { getGameSessions } = await import('./game');

    try {
      await getGameSessions({ accessToken: 'test-access-token' });
      expect.fail('ApiError が throw されるべき');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).message).toBe('ゲーム履歴のレスポンス形式が不正です');
    }
  });
});
