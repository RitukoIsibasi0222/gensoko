import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    element: {
      findMany: vi.fn(),
    },
    weakElement: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    gameQuestionSet: {
      create: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    gameSession: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    gameAnswer: {
      createMany: vi.fn(),
    },
    userStats: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma.js";
import {
  createGameQuestionSet,
  GAME_SESSION_DURATION_LIMIT_SEC,
  GameSessionValidationError,
  InsufficientWeakElementsError,
  QUESTION_TIME_LIMIT_SEC,
  QuestionSetAlreadySubmittedError,
  QuestionSetExpiredError,
  QuestionSetNotFoundError,
  submitGameSession,
} from "./game.service.js";

const ELEMENTS = [
  {
    id: 1,
    symbol: "H",
    nameJa: "水素",
    nameEn: "Hydrogen",
    category: "非金属",
    period: 1,
    group: 1,
    atomicWeight: 1.008,
    etymology: null,
  },
  {
    id: 2,
    symbol: "He",
    nameJa: "ヘリウム",
    nameEn: "Helium",
    category: "希ガス",
    period: 1,
    group: 18,
    atomicWeight: 4.003,
    etymology: null,
  },
  {
    id: 3,
    symbol: "Li",
    nameJa: "リチウム",
    nameEn: "Lithium",
    category: "アルカリ金属",
    period: 2,
    group: 1,
    atomicWeight: 6.94,
    etymology: null,
  },
  {
    id: 4,
    symbol: "Be",
    nameJa: "ベリリウム",
    nameEn: "Beryllium",
    category: "アルカリ土類金属",
    period: 2,
    group: 2,
    atomicWeight: 9.0122,
    etymology: null,
  },
  {
    id: 5,
    symbol: "B",
    nameJa: "ホウ素",
    nameEn: "Boron",
    category: "半金属",
    period: 2,
    group: 13,
    atomicWeight: 10.81,
    etymology: null,
  },
  {
    id: 6,
    symbol: "C",
    nameJa: "炭素",
    nameEn: "Carbon",
    category: "非金属",
    period: 2,
    group: 14,
    atomicWeight: 12.011,
    etymology: null,
  },
  {
    id: 7,
    symbol: "N",
    nameJa: "窒素",
    nameEn: "Nitrogen",
    category: "非金属",
    period: 2,
    group: 15,
    atomicWeight: 14.007,
    etymology: null,
  },
  {
    id: 8,
    symbol: "O",
    nameJa: "酸素",
    nameEn: "Oxygen",
    category: "非金属",
    period: 2,
    group: 16,
    atomicWeight: 15.999,
    etymology: null,
  },
  {
    id: 9,
    symbol: "F",
    nameJa: "フッ素",
    nameEn: "Fluorine",
    category: "ハロゲン",
    period: 2,
    group: 17,
    atomicWeight: 18.998,
    etymology: null,
  },
  {
    id: 10,
    symbol: "Ne",
    nameJa: "ネオン",
    nameEn: "Neon",
    category: "希ガス",
    period: 2,
    group: 18,
    atomicWeight: 20.18,
    etymology: null,
  },
];

const NOW = new Date("2026-06-20T12:00:00.000Z");
const FIRST_CHOICE_INDEX_GENERATOR = () => 0;

function createChoiceIndexGenerator(indexes: readonly number[]): () => number {
  let currentIndex = 0;

  return () => {
    const choiceIndex = indexes[currentIndex % indexes.length];
    currentIndex += 1;

    return choiceIndex;
  };
}

describe("createGameQuestionSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.element.findMany).mockResolvedValue(ELEMENTS);
    vi.mocked(prisma.gameQuestionSet.create).mockResolvedValue({
      id: "question-set-1",
      userId: "user-1",
      mode: "SYMBOL_TO_NAME_LV1",
      questions: [],
      expiresAt: new Date("2026-06-20T12:30:00.000Z"),
      createdAt: NOW,
    } as never);
  });

  it("記号→名前モードの公開レスポンスに questionSetId と10問4択を返し、正解情報を公開しない", async () => {
    const result = await createGameQuestionSet({
      userId: "user-1",
      mode: "SYMBOL_TO_NAME_LV1",
      now: NOW,
      choiceIndexGenerator: FIRST_CHOICE_INDEX_GENERATOR,
    });

    expect(result.questionSetId).toBe("question-set-1");
    expect(result.expiresAt).toEqual(new Date("2026-06-20T12:30:00.000Z"));
    expect(result.questions).toHaveLength(10);
    expect(result.questions[0]).toEqual({
      questionId: "q1",
      prompt: "H",
      choices: [
        { choiceId: "1", text: "水素" },
        { choiceId: "2", text: "ヘリウム" },
        { choiceId: "3", text: "リチウム" },
        { choiceId: "4", text: "ベリリウム" },
      ],
    });
    expect(result.questions[0]).not.toHaveProperty("correctChoiceId");
    expect(result.questions[0].choices[0]).not.toHaveProperty("elementId");
  });

  it("DB保存用 JSON にはサーバー正誤判定に必要な elementId と correctChoiceId を含める", async () => {
    await createGameQuestionSet({
      userId: "user-1",
      mode: "SYMBOL_TO_NAME_LV1",
      now: NOW,
      choiceIndexGenerator: FIRST_CHOICE_INDEX_GENERATOR,
    });

    expect(prisma.gameQuestionSet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        mode: "SYMBOL_TO_NAME_LV1",
        expiresAt: new Date("2026-06-20T12:30:00.000Z"),
        questions: expect.arrayContaining([
          expect.objectContaining({
            questionId: "q1",
            elementId: 1,
            correctChoiceId: "1",
            choices: expect.arrayContaining([
              expect.objectContaining({ choiceId: "1", elementId: 1, text: "水素" }),
            ]),
          }),
        ]),
      }),
    });
  });

  it("正解選択肢の位置を先頭に固定しない", async () => {
    const result = await createGameQuestionSet({
      userId: "user-1",
      mode: "SYMBOL_TO_NAME_LV1",
      now: NOW,
      choiceIndexGenerator: createChoiceIndexGenerator([0, 1, 2, 3]),
    });

    const correctChoiceIndexes = result.questions.slice(0, 4).map((question, index) => {
      const correctChoiceId = String(index + 1);

      return question.choices.findIndex((choice) => choice.choiceId === correctChoiceId);
    });

    expect(correctChoiceIndexes).toEqual([0, 1, 2, 3]);
  });

  it("名前→記号モードでは日本語名を prompt にし、選択肢を記号にする", async () => {
    const result = await createGameQuestionSet({
      userId: "user-1",
      mode: "NAME_TO_SYMBOL_LV1",
      now: NOW,
      choiceIndexGenerator: FIRST_CHOICE_INDEX_GENERATOR,
    });

    expect(result.questions[0]).toMatchObject({
      prompt: "水素",
      choices: [
        { choiceId: "1", text: "H" },
        { choiceId: "2", text: "He" },
        { choiceId: "3", text: "Li" },
        { choiceId: "4", text: "Be" },
      ],
    });
  });

  it("候補元素が4件未満の場合は問題セットを作成しない", async () => {
    vi.mocked(prisma.element.findMany).mockResolvedValue(ELEMENTS.slice(0, 3));

    await expect(
      createGameQuestionSet({
        userId: "user-1",
        mode: "SYMBOL_TO_NAME_LV1",
        now: NOW,
        choiceIndexGenerator: FIRST_CHOICE_INDEX_GENERATOR,
      }),
    ).rejects.toThrow("問題を生成できません");
    expect(prisma.gameQuestionSet.create).not.toHaveBeenCalled();
  });

  it("苦手モードで苦手元素が5件未満の場合はエラーにする", async () => {
    vi.mocked(prisma.weakElement.findMany).mockResolvedValue(
      ELEMENTS.slice(0, 4).map((element) => ({ element })) as never,
    );

    await expect(
      createGameQuestionSet({
        userId: "user-1",
        mode: "WEAK_SYMBOL_TO_NAME",
        now: NOW,
        choiceIndexGenerator: FIRST_CHOICE_INDEX_GENERATOR,
      }),
    ).rejects.toBeInstanceOf(InsufficientWeakElementsError);
    expect(prisma.gameQuestionSet.create).not.toHaveBeenCalled();
  });
});

describe("submitGameSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      return callback(prisma);
    });
    vi.mocked(prisma.gameQuestionSet.findFirst).mockResolvedValue({
      id: "question-set-1",
      userId: "user-1",
      mode: "SYMBOL_TO_NAME_LV1",
      expiresAt: new Date("2026-06-20T12:30:00.000Z"),
      createdAt: NOW,
      questions: [
        {
          questionId: "q1",
          elementId: 1,
          prompt: "H",
          correctChoiceId: "1",
          choices: [
            { choiceId: "1", elementId: 1, text: "水素" },
            { choiceId: "2", elementId: 2, text: "ヘリウム" },
            { choiceId: "3", elementId: 3, text: "リチウム" },
            { choiceId: "4", elementId: 4, text: "ベリリウム" },
          ],
        },
        {
          questionId: "q2",
          elementId: 2,
          prompt: "He",
          correctChoiceId: "2",
          choices: [
            { choiceId: "1", elementId: 1, text: "水素" },
            { choiceId: "2", elementId: 2, text: "ヘリウム" },
            { choiceId: "3", elementId: 3, text: "リチウム" },
            { choiceId: "4", elementId: 4, text: "ベリリウム" },
          ],
        },
      ],
    } as never);
    vi.mocked(prisma.gameQuestionSet.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.gameSession.create).mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      mode: "SYMBOL_TO_NAME_LV1",
      totalScore: 100,
      correctCount: 1,
      totalCount: 2,
      maxStreak: 1,
      durationSec: 20,
      playedAt: new Date("2026-06-20T12:05:00.000Z"),
    } as never);
    vi.mocked(prisma.gameAnswer.createMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.weakElement.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.weakElement.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.weakElement.update).mockResolvedValue({} as never);
    vi.mocked(prisma.weakElement.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue({ userId: "user-1" } as never);
    vi.mocked(prisma.userStats.upsert).mockResolvedValue({} as never);
  });

  it("保存済み問題セットを使って正誤判定・スコア計算・結果保存を行う", async () => {
    const result = await submitGameSession({
      userId: "user-1",
      questionSetId: "question-set-1",
      mode: "SYMBOL_TO_NAME_LV1",
      answers: [
        { questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 },
        { questionId: "q2", chosenChoiceId: null, answerTimeSec: 15 },
      ],
      durationSec: 20,
      now: new Date("2026-06-20T12:05:00.000Z"),
    });

    expect(result).toEqual({
      sessionId: "session-1",
      mode: "SYMBOL_TO_NAME_LV1",
      correctCount: 1,
      totalCount: 2,
      totalScore: 100,
      maxStreak: 1,
      durationSec: 20,
      playedAt: new Date("2026-06-20T12:05:00.000Z"),
      results: [
        {
          questionId: "q1",
          elementId: 1,
          prompt: "H",
          chosenChoiceId: "1",
          isCorrect: true,
          correctAnswer: "水素",
          yourAnswer: "水素",
          answerTimeSec: 5,
          score: 100,
        },
        {
          questionId: "q2",
          elementId: 2,
          prompt: "He",
          chosenChoiceId: null,
          isCorrect: false,
          correctAnswer: "ヘリウム",
          yourAnswer: null,
          answerTimeSec: 15,
          score: 0,
        },
      ],
    });
    expect(prisma.gameQuestionSet.deleteMany).toHaveBeenCalledWith({
      where: { id: "question-set-1", userId: "user-1" },
    });
  });

  it("不正解または時間切れの元素を苦手リストにupsertする", async () => {
    await submitGameSession({
      userId: "user-1",
      questionSetId: "question-set-1",
      mode: "SYMBOL_TO_NAME_LV1",
      answers: [
        { questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 },
        { questionId: "q2", chosenChoiceId: null, answerTimeSec: 15 },
      ],
      durationSec: 20,
      now: new Date("2026-06-20T12:05:00.000Z"),
    });

    expect(prisma.weakElement.upsert).toHaveBeenCalledWith({
      where: { userId_elementId: { userId: "user-1", elementId: 2 } },
      create: { userId: "user-1", elementId: 2, missCount: 1, consecutiveHit: 0 },
      update: { missCount: { increment: 1 }, consecutiveHit: 0 },
    });
  });

  it("苦手元素に正解した場合はconsecutiveHitを増やす", async () => {
    vi.mocked(prisma.weakElement.findUnique).mockResolvedValue({
      id: "weak-1",
      userId: "user-1",
      elementId: 1,
      missCount: 2,
      consecutiveHit: 0,
      addedAt: NOW,
      updatedAt: NOW,
    } as never);

    await submitGameSession({
      userId: "user-1",
      questionSetId: "question-set-1",
      mode: "SYMBOL_TO_NAME_LV1",
      answers: [
        { questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 },
        { questionId: "q2", chosenChoiceId: null, answerTimeSec: 15 },
      ],
      durationSec: 20,
      now: new Date("2026-06-20T12:05:00.000Z"),
    });

    expect(prisma.weakElement.update).toHaveBeenCalledWith({
      where: { id: "weak-1" },
      data: { consecutiveHit: { increment: 1 } },
    });
  });

  it("苦手元素に2回連続正解した場合は苦手リストから削除する", async () => {
    vi.mocked(prisma.weakElement.findUnique).mockResolvedValue({
      id: "weak-1",
      userId: "user-1",
      elementId: 1,
      missCount: 2,
      consecutiveHit: 1,
      addedAt: NOW,
      updatedAt: NOW,
    } as never);

    await submitGameSession({
      userId: "user-1",
      questionSetId: "question-set-1",
      mode: "SYMBOL_TO_NAME_LV1",
      answers: [
        { questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 },
        { questionId: "q2", chosenChoiceId: null, answerTimeSec: 15 },
      ],
      durationSec: 20,
      now: new Date("2026-06-20T12:05:00.000Z"),
    });

    expect(prisma.weakElement.delete).toHaveBeenCalledWith({
      where: { id: "weak-1" },
    });
  });

  it("同一セッション内で同じ苦手元素に複数回正解してもconsecutiveHitは1回だけ増やす", async () => {
    vi.mocked(prisma.gameQuestionSet.findFirst).mockResolvedValue({
      id: "question-set-1",
      userId: "user-1",
      mode: "SYMBOL_TO_NAME_LV1",
      expiresAt: new Date("2026-06-20T12:30:00.000Z"),
      createdAt: NOW,
      questions: [
        {
          questionId: "q1",
          elementId: 1,
          prompt: "H",
          correctChoiceId: "1",
          choices: [
            { choiceId: "1", elementId: 1, text: "水素" },
            { choiceId: "2", elementId: 2, text: "ヘリウム" },
            { choiceId: "3", elementId: 3, text: "リチウム" },
            { choiceId: "4", elementId: 4, text: "ベリリウム" },
          ],
        },
        {
          questionId: "q2",
          elementId: 1,
          prompt: "H",
          correctChoiceId: "1",
          choices: [
            { choiceId: "1", elementId: 1, text: "水素" },
            { choiceId: "2", elementId: 2, text: "ヘリウム" },
            { choiceId: "3", elementId: 3, text: "リチウム" },
            { choiceId: "4", elementId: 4, text: "ベリリウム" },
          ],
        },
      ],
    } as never);
    vi.mocked(prisma.weakElement.findUnique).mockResolvedValue({
      id: "weak-1",
      userId: "user-1",
      elementId: 1,
      missCount: 2,
      consecutiveHit: 0,
      addedAt: NOW,
      updatedAt: NOW,
    } as never);

    await submitGameSession({
      userId: "user-1",
      questionSetId: "question-set-1",
      mode: "SYMBOL_TO_NAME_LV1",
      answers: [
        { questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 },
        { questionId: "q2", chosenChoiceId: "1", answerTimeSec: 4 },
      ],
      durationSec: 20,
      now: new Date("2026-06-20T12:05:00.000Z"),
    });

    expect(prisma.weakElement.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.weakElement.update).toHaveBeenCalledTimes(1);
    expect(prisma.weakElement.update).toHaveBeenCalledWith({
      where: { id: "weak-1" },
      data: { consecutiveHit: { increment: 1 } },
    });
    expect(prisma.weakElement.delete).not.toHaveBeenCalled();
  });

  it("同一セッション内で同じ元素を複数回不正解した場合はmissCountを不正解数だけ増やす", async () => {
    vi.mocked(prisma.gameQuestionSet.findFirst).mockResolvedValue({
      id: "question-set-1",
      userId: "user-1",
      mode: "SYMBOL_TO_NAME_LV1",
      expiresAt: new Date("2026-06-20T12:30:00.000Z"),
      createdAt: NOW,
      questions: [
        {
          questionId: "q1",
          elementId: 1,
          prompt: "H",
          correctChoiceId: "1",
          choices: [
            { choiceId: "1", elementId: 1, text: "水素" },
            { choiceId: "2", elementId: 2, text: "ヘリウム" },
            { choiceId: "3", elementId: 3, text: "リチウム" },
            { choiceId: "4", elementId: 4, text: "ベリリウム" },
          ],
        },
        {
          questionId: "q2",
          elementId: 1,
          prompt: "H",
          correctChoiceId: "1",
          choices: [
            { choiceId: "1", elementId: 1, text: "水素" },
            { choiceId: "2", elementId: 2, text: "ヘリウム" },
            { choiceId: "3", elementId: 3, text: "リチウム" },
            { choiceId: "4", elementId: 4, text: "ベリリウム" },
          ],
        },
      ],
    } as never);

    await submitGameSession({
      userId: "user-1",
      questionSetId: "question-set-1",
      mode: "SYMBOL_TO_NAME_LV1",
      answers: [
        { questionId: "q1", chosenChoiceId: "2", answerTimeSec: 5 },
        { questionId: "q2", chosenChoiceId: "2", answerTimeSec: 4 },
      ],
      durationSec: 20,
      now: new Date("2026-06-20T12:05:00.000Z"),
    });

    expect(prisma.weakElement.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.weakElement.upsert).toHaveBeenCalledWith({
      where: { userId_elementId: { userId: "user-1", elementId: 1 } },
      create: { userId: "user-1", elementId: 1, missCount: 2, consecutiveHit: 0 },
      update: { missCount: { increment: 2 }, consecutiveHit: 0 },
    });
  });

  it("ユーザー統計にゲーム回数・正解数・回答数・スコアを反映する", async () => {
    await submitGameSession({
      userId: "user-1",
      questionSetId: "question-set-1",
      mode: "SYMBOL_TO_NAME_LV1",
      answers: [
        { questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 },
        { questionId: "q2", chosenChoiceId: null, answerTimeSec: 15 },
      ],
      durationSec: 20,
      now: new Date("2026-06-20T12:05:00.000Z"),
    });

    expect(prisma.userStats.upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: {
        userId: "user-1",
        totalGames: 1,
        totalCorrect: 1,
        totalAnswered: 2,
        masteredCount: 0,
        weeklyScore: 100,
        allTimeScore: 100,
        lastActiveDate: new Date("2026-06-20T12:05:00.000Z"),
      },
      update: {
        totalGames: { increment: 1 },
        totalCorrect: { increment: 1 },
        totalAnswered: { increment: 2 },
        weeklyScore: { increment: 100 },
        allTimeScore: { increment: 100 },
        masteredCount: { increment: 0 },
        lastActiveDate: new Date("2026-06-20T12:05:00.000Z"),
      },
    });
  });

  it("今回セッションで変化した元素だけを見て習得済み元素数の差分を反映する", async () => {
    vi.mocked(prisma.gameSession.findMany)
      .mockResolvedValueOnce([
        { answers: [{ elementId: 1, isCorrect: true }] },
        { answers: [] },
      ] as never)
      .mockResolvedValueOnce([
        { answers: [{ elementId: 1, isCorrect: true }] },
        { answers: [{ elementId: 1, isCorrect: true }] },
      ] as never);

    await submitGameSession({
      userId: "user-1",
      questionSetId: "question-set-1",
      mode: "SYMBOL_TO_NAME_LV1",
      answers: [
        { questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 },
        { questionId: "q2", chosenChoiceId: null, answerTimeSec: 15 },
      ],
      durationSec: 20,
      now: new Date("2026-06-20T12:05:00.000Z"),
    });

    expect(prisma.userStats.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ masteredCount: 1 }),
        update: expect.objectContaining({ masteredCount: { increment: 1 } }),
      }),
    );
    expect(prisma.gameSession.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.gameSession.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        select: expect.objectContaining({
          answers: expect.objectContaining({
            where: { elementId: { in: [1, 2] } },
          }),
        }),
      }),
    );
  });

  it("今回セッションで習得状態から外れた元素は習得済み元素数を減らす", async () => {
    vi.mocked(prisma.gameSession.findMany)
      .mockResolvedValueOnce([
        {
          answers: [
            { elementId: 1, isCorrect: true },
            { elementId: 2, isCorrect: false },
          ],
        },
        { answers: [{ elementId: 1, isCorrect: true }] },
      ] as never)
      .mockResolvedValueOnce([
        {
          answers: [
            { elementId: 1, isCorrect: false },
            { elementId: 2, isCorrect: false },
          ],
        },
        { answers: [{ elementId: 1, isCorrect: true }] },
      ] as never);

    await submitGameSession({
      userId: "user-1",
      questionSetId: "question-set-1",
      mode: "SYMBOL_TO_NAME_LV1",
      answers: [
        { questionId: "q1", chosenChoiceId: "2", answerTimeSec: 5 },
        { questionId: "q2", chosenChoiceId: null, answerTimeSec: 15 },
      ],
      durationSec: 20,
      now: new Date("2026-06-20T12:05:00.000Z"),
    });

    expect(prisma.userStats.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ masteredCount: { increment: -1 } }),
      }),
    );
    expect(prisma.gameSession.findMany).toHaveBeenCalledTimes(2);
  });

  it("durationSec が上限を超える場合はDBトランザクション前にバリデーションエラーにする", async () => {
    await expect(
      submitGameSession({
        userId: "user-1",
        questionSetId: "question-set-1",
        mode: "SYMBOL_TO_NAME_LV1",
        answers: [
          { questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 },
          { questionId: "q2", chosenChoiceId: null, answerTimeSec: 15 },
        ],
        durationSec: GAME_SESSION_DURATION_LIMIT_SEC + 1,
        now: new Date("2026-06-20T12:05:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(GameSessionValidationError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("questionSetId が空文字の場合はDBトランザクション前にバリデーションエラーにする", async () => {
    await expect(
      submitGameSession({
        userId: "user-1",
        questionSetId: "   ",
        mode: "SYMBOL_TO_NAME_LV1",
        answers: [
          { questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 },
          { questionId: "q2", chosenChoiceId: null, answerTimeSec: 15 },
        ],
        durationSec: 20,
        now: new Date("2026-06-20T12:05:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(GameSessionValidationError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("answers が空配列の場合はDBトランザクション前にバリデーションエラーにする", async () => {
    await expect(
      submitGameSession({
        userId: "user-1",
        questionSetId: "question-set-1",
        mode: "SYMBOL_TO_NAME_LV1",
        answers: [],
        durationSec: 20,
        now: new Date("2026-06-20T12:05:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(GameSessionValidationError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("answerTimeSec が上限を超える場合はDBトランザクション前にバリデーションエラーにする", async () => {
    await expect(
      submitGameSession({
        userId: "user-1",
        questionSetId: "question-set-1",
        mode: "SYMBOL_TO_NAME_LV1",
        answers: [
          { questionId: "q1", chosenChoiceId: "1", answerTimeSec: QUESTION_TIME_LIMIT_SEC + 1 },
          { questionId: "q2", chosenChoiceId: null, answerTimeSec: 15 },
        ],
        durationSec: 20,
        now: new Date("2026-06-20T12:05:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(GameSessionValidationError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("answerTimeSec が整数でない場合はDBトランザクション前にバリデーションエラーにする", async () => {
    await expect(
      submitGameSession({
        userId: "user-1",
        questionSetId: "question-set-1",
        mode: "SYMBOL_TO_NAME_LV1",
        answers: [
          { questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5.5 },
          { questionId: "q2", chosenChoiceId: null, answerTimeSec: 15 },
        ],
        durationSec: 20,
        now: new Date("2026-06-20T12:05:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(GameSessionValidationError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("questionId と chosenChoiceId が空文字の場合はDBトランザクション前にバリデーションエラーにする", async () => {
    await expect(
      submitGameSession({
        userId: "user-1",
        questionSetId: "question-set-1",
        mode: "SYMBOL_TO_NAME_LV1",
        answers: [
          { questionId: "   ", chosenChoiceId: "1", answerTimeSec: 5 },
          { questionId: "q2", chosenChoiceId: "   ", answerTimeSec: 15 },
        ],
        durationSec: 20,
        now: new Date("2026-06-20T12:05:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(GameSessionValidationError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("問題セットが見つからない場合は専用エラーにする", async () => {
    vi.mocked(prisma.gameQuestionSet.findFirst).mockResolvedValue(null);

    await expect(
      submitGameSession({
        userId: "user-1",
        questionSetId: "missing-question-set",
        mode: "SYMBOL_TO_NAME_LV1",
        answers: [{ questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 }],
        durationSec: 20,
        now: new Date("2026-06-20T12:05:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(QuestionSetNotFoundError);
    expect(prisma.gameSession.create).not.toHaveBeenCalled();
  });

  it("問題セットが期限切れの場合は専用エラーにする", async () => {
    vi.mocked(prisma.gameQuestionSet.findFirst).mockResolvedValue({
      id: "question-set-1",
      userId: "user-1",
      mode: "SYMBOL_TO_NAME_LV1",
      expiresAt: new Date("2026-06-20T12:00:00.000Z"),
      createdAt: NOW,
      questions: [],
    } as never);

    await expect(
      submitGameSession({
        userId: "user-1",
        questionSetId: "question-set-1",
        mode: "SYMBOL_TO_NAME_LV1",
        answers: [{ questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 }],
        durationSec: 20,
        now: new Date("2026-06-20T12:05:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(QuestionSetExpiredError);
    expect(prisma.gameSession.create).not.toHaveBeenCalled();
  });

  it("問題セットの expiresAt と now が同一時刻の場合は期限切れにする", async () => {
    vi.mocked(prisma.gameQuestionSet.findFirst).mockResolvedValue({
      id: "question-set-1",
      userId: "user-1",
      mode: "SYMBOL_TO_NAME_LV1",
      expiresAt: new Date("2026-06-20T12:05:00.000Z"),
      createdAt: NOW,
      questions: [],
    } as never);

    await expect(
      submitGameSession({
        userId: "user-1",
        questionSetId: "question-set-1",
        mode: "SYMBOL_TO_NAME_LV1",
        answers: [{ questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 }],
        durationSec: 20,
        now: new Date("2026-06-20T12:05:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(QuestionSetExpiredError);
    expect(prisma.gameSession.create).not.toHaveBeenCalled();
  });

  it("未知の questionId が含まれる場合はバリデーションエラーにする", async () => {
    await expect(
      submitGameSession({
        userId: "user-1",
        questionSetId: "question-set-1",
        mode: "SYMBOL_TO_NAME_LV1",
        answers: [
          { questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 },
          { questionId: "unknown", chosenChoiceId: "2", answerTimeSec: 5 },
        ],
        durationSec: 20,
        now: new Date("2026-06-20T12:05:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(GameSessionValidationError);
    expect(prisma.gameSession.create).not.toHaveBeenCalled();
  });

  it("未知の choiceId が含まれる場合はバリデーションエラーにする", async () => {
    await expect(
      submitGameSession({
        userId: "user-1",
        questionSetId: "question-set-1",
        mode: "SYMBOL_TO_NAME_LV1",
        answers: [
          { questionId: "q1", chosenChoiceId: "999", answerTimeSec: 5 },
          { questionId: "q2", chosenChoiceId: "2", answerTimeSec: 5 },
        ],
        durationSec: 20,
        now: new Date("2026-06-20T12:05:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(GameSessionValidationError);
    expect(prisma.gameSession.create).not.toHaveBeenCalled();
  });

  it("問題セットを消費できなかった場合は二重送信エラーにする", async () => {
    vi.mocked(prisma.gameQuestionSet.deleteMany).mockResolvedValue({ count: 0 } as never);

    await expect(
      submitGameSession({
        userId: "user-1",
        questionSetId: "question-set-1",
        mode: "SYMBOL_TO_NAME_LV1",
        answers: [
          { questionId: "q1", chosenChoiceId: "1", answerTimeSec: 5 },
          { questionId: "q2", chosenChoiceId: "2", answerTimeSec: 5 },
        ],
        durationSec: 20,
        now: new Date("2026-06-20T12:05:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(QuestionSetAlreadySubmittedError);
    expect(prisma.gameSession.create).not.toHaveBeenCalled();
  });
});
