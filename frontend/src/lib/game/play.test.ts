import { describe, expect, it } from 'vitest';
import { QUESTION_TIME_LIMIT_SEC } from '$lib/game/constants';
import {
  buildSessionAnswerDraft,
  buildAnswerDraft,
  calculateAnswerDurationSec,
  getNextQuestionIndex,
  getProgressLabel,
  getTimerPercent,
  normalizeGameModeParam,
  summarizeAnswers
} from '$lib/game/play';
import type { GamePlayQuestion, MockGamePlayQuestion } from '$lib/game/types';

const QUESTION: MockGamePlayQuestion = {
  questionId: 'q1',
  prompt: 'H',
  correctChoiceId: 'c1',
  choices: [
    { choiceId: 'c1', text: '水素' },
    { choiceId: 'c2', text: '炭素' },
    { choiceId: 'c3', text: '酸素' },
    { choiceId: 'c4', text: '窒素' }
  ]
};

const API_QUESTION: GamePlayQuestion = {
  questionId: 'q1',
  prompt: 'H',
  choices: [
    { choiceId: 'c1', text: '水素' },
    { choiceId: 'c2', text: '炭素' },
    { choiceId: 'c3', text: '酸素' },
    { choiceId: 'c4', text: '窒素' }
  ]
};

describe('normalizeGameModeParam', () => {
  it('有効なゲームモードを返す', () => {
    expect(normalizeGameModeParam('SYMBOL_TO_NAME_LV1')).toBe('SYMBOL_TO_NAME_LV1');
    expect(normalizeGameModeParam('WEAK_NAME_TO_SYMBOL')).toBe('WEAK_NAME_TO_SYMBOL');
  });

  it('null や未知の値は null を返す', () => {
    expect(normalizeGameModeParam(null)).toBeNull();
    expect(normalizeGameModeParam('')).toBeNull();
    expect(normalizeGameModeParam('UNKNOWN')).toBeNull();
  });
});

describe('getProgressLabel', () => {
  it('0始まりの index をユーザー向けの進捗ラベルに変換する', () => {
    expect(getProgressLabel(0, 10)).toBe('1 / 10問');
    expect(getProgressLabel(9, 10)).toBe('10 / 10問');
  });

  it('範囲外の index は表示可能な範囲に丸める', () => {
    expect(getProgressLabel(-1, 10)).toBe('1 / 10問');
    expect(getProgressLabel(20, 10)).toBe('10 / 10問');
  });
});

describe('getTimerPercent', () => {
  it('残り時間から 0 から 100 の割合を返す', () => {
    expect(getTimerPercent(QUESTION_TIME_LIMIT_SEC, QUESTION_TIME_LIMIT_SEC)).toBe(100);
    expect(getTimerPercent(0, QUESTION_TIME_LIMIT_SEC)).toBe(0);
  });

  it('範囲外の値は 0 から 100 に丸める', () => {
    expect(getTimerPercent(20, QUESTION_TIME_LIMIT_SEC)).toBe(100);
    expect(getTimerPercent(-1, QUESTION_TIME_LIMIT_SEC)).toBe(0);
    expect(getTimerPercent(1, 0)).toBe(0);
  });
});

describe('buildAnswerDraft', () => {
  it('正解選択時の回答を作成する', () => {
    expect(
      buildAnswerDraft({
        question: QUESTION,
        chosenChoiceId: 'c1',
        remainingSec: 11,
        timeLimitSec: QUESTION_TIME_LIMIT_SEC
      })
    ).toEqual({
      questionId: 'q1',
      chosenChoiceId: 'c1',
      answerTimeSec: 4,
      isCorrect: true,
      timedOut: false
    });
  });

  it('不正解選択時の回答を作成する', () => {
    expect(
      buildAnswerDraft({
        question: QUESTION,
        chosenChoiceId: 'c2',
        remainingSec: 7,
        timeLimitSec: QUESTION_TIME_LIMIT_SEC
      })
    ).toMatchObject({
      questionId: 'q1',
      chosenChoiceId: 'c2',
      answerTimeSec: 8,
      isCorrect: false,
      timedOut: false
    });
  });

  it('時間切れ時の回答を作成する', () => {
    expect(
      buildAnswerDraft({
        question: QUESTION,
        chosenChoiceId: null,
        remainingSec: 0,
        timeLimitSec: QUESTION_TIME_LIMIT_SEC
      })
    ).toEqual({
      questionId: 'q1',
      chosenChoiceId: null,
      answerTimeSec: QUESTION_TIME_LIMIT_SEC,
      isCorrect: false,
      timedOut: true
    });
  });

  it('remainingSec が範囲外の場合は回答時間を 0 から timeLimitSec に丸める', () => {
    expect(
      buildAnswerDraft({
        question: QUESTION,
        chosenChoiceId: 'c1',
        remainingSec: QUESTION_TIME_LIMIT_SEC + 5,
        timeLimitSec: QUESTION_TIME_LIMIT_SEC
      }).answerTimeSec
    ).toBe(0);

    expect(
      buildAnswerDraft({
        question: QUESTION,
        chosenChoiceId: 'c1',
        remainingSec: -5,
        timeLimitSec: QUESTION_TIME_LIMIT_SEC
      }).answerTimeSec
    ).toBe(QUESTION_TIME_LIMIT_SEC);
  });
});

describe('buildSessionAnswerDraft', () => {
  it('本番 API 送信用に正誤情報を含まない回答を作成する', () => {
    const answer = buildSessionAnswerDraft({
      question: API_QUESTION,
      chosenChoiceId: 'c1',
      remainingSec: 11,
      timeLimitSec: QUESTION_TIME_LIMIT_SEC
    });

    expect(answer).toEqual({
      questionId: 'q1',
      chosenChoiceId: 'c1',
      answerTimeSec: 4
    });
    expect('isCorrect' in answer).toBe(false);
    expect('correctChoiceId' in answer).toBe(false);
  });

  it('時間切れ時は chosenChoiceId を null、回答時間を timeLimitSec にする', () => {
    expect(
      buildSessionAnswerDraft({
        question: API_QUESTION,
        chosenChoiceId: null,
        remainingSec: 0,
        timeLimitSec: QUESTION_TIME_LIMIT_SEC
      })
    ).toEqual({
      questionId: 'q1',
      chosenChoiceId: null,
      answerTimeSec: QUESTION_TIME_LIMIT_SEC
    });
  });

  it('remainingSec が範囲外の場合は回答時間を 0 から timeLimitSec に丸める', () => {
    expect(
      buildSessionAnswerDraft({
        question: API_QUESTION,
        chosenChoiceId: 'c1',
        remainingSec: QUESTION_TIME_LIMIT_SEC + 5,
        timeLimitSec: QUESTION_TIME_LIMIT_SEC
      }).answerTimeSec
    ).toBe(0);

    expect(
      buildSessionAnswerDraft({
        question: API_QUESTION,
        chosenChoiceId: 'c1',
        remainingSec: -5,
        timeLimitSec: QUESTION_TIME_LIMIT_SEC
      }).answerTimeSec
    ).toBe(QUESTION_TIME_LIMIT_SEC);
  });
});

describe('getNextQuestionIndex', () => {
  it('次の問題がある場合は次 index を返す', () => {
    expect(getNextQuestionIndex(0, 10)).toBe(1);
  });

  it('最後の問題では null を返す', () => {
    expect(getNextQuestionIndex(9, 10)).toBeNull();
  });
});

describe('calculateAnswerDurationSec', () => {
  it('回答時間の合計を返す', () => {
    expect(
      calculateAnswerDurationSec(
        [{ answerTimeSec: 4 }, { answerTimeSec: 15 }, { answerTimeSec: 3 }],
        1800
      )
    ).toBe(22);
  });

  it('合計が上限を超える場合は maxDurationSec に丸める', () => {
    expect(
      calculateAnswerDurationSec([{ answerTimeSec: 1000 }, { answerTimeSec: 1000 }], 1800)
    ).toBe(1800);
  });
});

describe('summarizeAnswers', () => {
  it('回答一覧から正解数と合計数を返す', () => {
    expect(
      summarizeAnswers([
        {
          questionId: 'q1',
          chosenChoiceId: 'c1',
          answerTimeSec: 4,
          isCorrect: true,
          timedOut: false
        },
        {
          questionId: 'q2',
          chosenChoiceId: null,
          answerTimeSec: 15,
          isCorrect: false,
          timedOut: true
        }
      ])
    ).toEqual({
      correctCount: 1,
      totalCount: 2
    });
  });
});
