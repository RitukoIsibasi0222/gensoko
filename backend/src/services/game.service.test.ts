import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    element: {
      findMany: vi.fn(),
    },
    weakElement: {
      findMany: vi.fn(),
    },
    gameQuestionSet: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma.js";
import { createGameQuestionSet, InsufficientWeakElementsError } from "./game.service.js";

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

  it("名前→記号モードでは日本語名を prompt にし、選択肢を記号にする", async () => {
    const result = await createGameQuestionSet({
      userId: "user-1",
      mode: "NAME_TO_SYMBOL_LV1",
      now: NOW,
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

  it("苦手モードで苦手元素が5件未満の場合はエラーにする", async () => {
    vi.mocked(prisma.weakElement.findMany).mockResolvedValue(
      ELEMENTS.slice(0, 4).map((element) => ({ element })) as never,
    );

    await expect(
      createGameQuestionSet({
        userId: "user-1",
        mode: "WEAK_SYMBOL_TO_NAME",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(InsufficientWeakElementsError);
    expect(prisma.gameQuestionSet.create).not.toHaveBeenCalled();
  });
});
