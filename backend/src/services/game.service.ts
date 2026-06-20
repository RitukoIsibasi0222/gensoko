import type { Element as PrismaElement, GameMode, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const GAME_QUESTION_COUNT = 10;
const GAME_CHOICE_COUNT = 4;
const MIN_WEAK_ELEMENTS_FOR_GAME = 5;
const QUESTION_SET_EXPIRES_MS = 30 * 60 * 1000;

export type PublicGameChoice = {
  choiceId: string;
  text: string;
};

export type PublicGameQuestion = {
  questionId: string;
  prompt: string;
  choices: PublicGameChoice[];
};

export type CreateGameQuestionSetResult = {
  questionSetId: string;
  expiresAt: Date;
  questions: PublicGameQuestion[];
};

type StoredGameChoice = PublicGameChoice & {
  elementId: number;
};

type StoredGameQuestion = PublicGameQuestion & {
  elementId: number;
  correctChoiceId: string;
  choices: StoredGameChoice[];
};

type CreateGameQuestionSetParams = {
  userId: string;
  mode: GameMode;
  now?: Date;
};

export class InsufficientWeakElementsError extends Error {
  constructor() {
    super("苦手モードを始めるには、苦手元素が5件以上必要です");
    this.name = "InsufficientWeakElementsError";
  }
}

function isNameToSymbolMode(mode: GameMode): boolean {
  return (
    mode === "NAME_TO_SYMBOL_LV1" || mode === "NAME_TO_SYMBOL_LV2" || mode === "WEAK_NAME_TO_SYMBOL"
  );
}

function isWeakGameMode(mode: GameMode): boolean {
  return mode === "WEAK_SYMBOL_TO_NAME" || mode === "WEAK_NAME_TO_SYMBOL";
}

function getNormalModeWhere(mode: GameMode): Prisma.ElementWhereInput {
  if (mode === "SYMBOL_TO_NAME_LV1" || mode === "NAME_TO_SYMBOL_LV1") {
    return { id: { lte: 20 } };
  }

  return { id: { gte: 21 } };
}

async function getCandidateElements(userId: string, mode: GameMode): Promise<PrismaElement[]> {
  if (!isWeakGameMode(mode)) {
    return prisma.element.findMany({
      where: getNormalModeWhere(mode),
      orderBy: { id: "asc" },
    });
  }

  const weakElements = await prisma.weakElement.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { addedAt: "desc" }],
    include: { element: true },
  });

  if (weakElements.length < MIN_WEAK_ELEMENTS_FOR_GAME) {
    throw new InsufficientWeakElementsError();
  }

  return weakElements.map((weakElement) => weakElement.element);
}

function buildQuestionElements(elements: readonly PrismaElement[]): PrismaElement[] {
  if (elements.length === 0) {
    return [];
  }

  return Array.from(
    { length: GAME_QUESTION_COUNT },
    (_, index) => elements[index % elements.length],
  );
}

function getChoiceText(element: PrismaElement, answerWithSymbol: boolean): string {
  return answerWithSymbol ? element.symbol : element.nameJa;
}

function getPrompt(element: PrismaElement, answerWithSymbol: boolean): string {
  return answerWithSymbol ? element.nameJa : element.symbol;
}

function buildChoices({
  candidates,
  correctElement,
  answerWithSymbol,
}: {
  candidates: readonly PrismaElement[];
  correctElement: PrismaElement;
  answerWithSymbol: boolean;
}): StoredGameChoice[] {
  const distractors = candidates
    .filter((element) => element.id !== correctElement.id)
    .slice(0, GAME_CHOICE_COUNT - 1);

  if (distractors.length < GAME_CHOICE_COUNT - 1) {
    throw new Error("選択肢を生成できません");
  }

  return [correctElement, ...distractors].map((element) => ({
    choiceId: String(element.id),
    elementId: element.id,
    text: getChoiceText(element, answerWithSymbol),
  }));
}

function toPublicQuestion(question: StoredGameQuestion): PublicGameQuestion {
  return {
    questionId: question.questionId,
    prompt: question.prompt,
    choices: question.choices.map((choice) => ({
      choiceId: choice.choiceId,
      text: choice.text,
    })),
  };
}

function buildStoredQuestions(
  mode: GameMode,
  candidates: readonly PrismaElement[],
): StoredGameQuestion[] {
  const answerWithSymbol = isNameToSymbolMode(mode);
  const questionElements = buildQuestionElements(candidates);

  return questionElements.map((element, index) => {
    const choices = buildChoices({
      candidates,
      correctElement: element,
      answerWithSymbol,
    });

    return {
      questionId: `q${index + 1}`,
      elementId: element.id,
      prompt: getPrompt(element, answerWithSymbol),
      correctChoiceId: String(element.id),
      choices,
    };
  });
}

export async function createGameQuestionSet({
  userId,
  mode,
  now = new Date(),
}: CreateGameQuestionSetParams): Promise<CreateGameQuestionSetResult> {
  const candidates = await getCandidateElements(userId, mode);
  const questions = buildStoredQuestions(mode, candidates);
  const expiresAt = new Date(now.getTime() + QUESTION_SET_EXPIRES_MS);

  const questionSet = await prisma.gameQuestionSet.create({
    data: {
      userId,
      mode,
      questions: questions as unknown as Prisma.InputJsonValue,
      expiresAt,
    },
  });

  return {
    questionSetId: questionSet.id,
    expiresAt: questionSet.expiresAt,
    questions: questions.map(toPublicQuestion),
  };
}
