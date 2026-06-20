import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';

vi.mock('$lib/api/config', () => ({
  API_BASE_URL: 'http://localhost:3000/api/v1'
}));

const { getGameQuestions, submitGameSession } = await import('./game');

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
