import { randomInt } from "node:crypto";
import type { Element as PrismaElement, GameMode, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getElementMasteryStatusMap } from "./element-mastery.service.js";

const GAME_QUESTION_COUNT = 10;
const GAME_CHOICE_COUNT = 4;
const MIN_WEAK_ELEMENTS_FOR_GAME = 5;
const QUESTION_SET_EXPIRES_MS = 30 * 60 * 1000;
const QUESTION_TIME_LIMIT_SEC = 15;
const BASE_CORRECT_SCORE = 100;
const TIME_BONUS_PER_SEC = 5;
const WEAK_ELEMENT_MASTERED_CONSECUTIVE_HIT_COUNT = 2;
const ELEMENT_ID_MIN = 1;
const ELEMENT_ID_MAX = 118;
const ALL_ELEMENT_IDS = Array.from(
  { length: ELEMENT_ID_MAX - ELEMENT_ID_MIN + 1 },
  (_, index) => ELEMENT_ID_MIN + index,
);

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

export type SubmitGameSessionAnswer = {
  questionId: string;
  chosenChoiceId: string | null;
  answerTimeSec: number;
};

export type SubmitGameSessionParams = {
  userId: string;
  questionSetId: string;
  mode: GameMode;
  answers: SubmitGameSessionAnswer[];
  durationSec: number;
  now?: Date;
};

export type GameSessionResultItem = {
  questionId: string;
  elementId: number;
  prompt: string;
  chosenChoiceId: string | null;
  isCorrect: boolean;
  correctAnswer: string;
  yourAnswer: string | null;
  answerTimeSec: number;
  score: number;
};

export type SubmitGameSessionResult = {
  sessionId: string;
  mode: GameMode;
  correctCount: number;
  totalCount: number;
  totalScore: number;
  maxStreak: number;
  durationSec: number;
  playedAt: Date;
  results: GameSessionResultItem[];
};

type StoredGameChoice = PublicGameChoice & {
  elementId: number;
};

type StoredGameQuestion = {
  questionId: string;
  prompt: string;
  elementId: number;
  correctChoiceId: string;
  choices: StoredGameChoice[];
};

type CreateGameQuestionSetParams = {
  userId: string;
  mode: GameMode;
  now?: Date;
  choiceIndexGenerator?: () => number;
};

export class InsufficientWeakElementsError extends Error {
  constructor() {
    super("苦手モードを始めるには、苦手元素が5件以上必要です");
    this.name = "InsufficientWeakElementsError";
  }
}

export class QuestionSetNotFoundError extends Error {
  constructor() {
    super("問題セットが見つかりません");
    this.name = "QuestionSetNotFoundError";
  }
}

export class QuestionSetExpiredError extends Error {
  constructor() {
    super("問題セットの有効期限が切れています。もう一度ゲームを開始してください");
    this.name = "QuestionSetExpiredError";
  }
}

export class QuestionSetModeMismatchError extends Error {
  constructor() {
    super("問題セットのゲームモードが一致しません");
    this.name = "QuestionSetModeMismatchError";
  }
}

export class QuestionSetAlreadySubmittedError extends Error {
  constructor() {
    super("問題セットはすでに送信済みです");
    this.name = "QuestionSetAlreadySubmittedError";
  }
}

export class GameSessionValidationError extends Error {
  constructor() {
    super("回答形式が正しくありません");
    this.name = "GameSessionValidationError";
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
  correctChoiceIndex,
}: {
  candidates: readonly PrismaElement[];
  correctElement: PrismaElement;
  answerWithSymbol: boolean;
  correctChoiceIndex: number;
}): StoredGameChoice[] {
  const distractors = candidates
    .filter((element) => element.id !== correctElement.id)
    .slice(0, GAME_CHOICE_COUNT - 1);

  if (distractors.length < GAME_CHOICE_COUNT - 1) {
    throw new Error("選択肢を生成できません");
  }

  if (
    !Number.isInteger(correctChoiceIndex) ||
    correctChoiceIndex < 0 ||
    correctChoiceIndex >= GAME_CHOICE_COUNT
  ) {
    throw new Error("選択肢を生成できません");
  }

  const choiceElements = [...distractors];
  choiceElements.splice(correctChoiceIndex, 0, correctElement);

  return choiceElements.map((element) => ({
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

function toQuestionSetJson(questions: readonly StoredGameQuestion[]): Prisma.InputJsonValue {
  return questions.map((question) => ({
    questionId: question.questionId,
    elementId: question.elementId,
    prompt: question.prompt,
    correctChoiceId: question.correctChoiceId,
    choices: question.choices.map((choice) => ({
      choiceId: choice.choiceId,
      elementId: choice.elementId,
      text: choice.text,
    })),
  }));
}

function isStoredGameChoice(value: unknown): value is StoredGameChoice {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const choice = value as Record<string, unknown>;
  return (
    typeof choice.choiceId === "string" &&
    typeof choice.elementId === "number" &&
    typeof choice.text === "string"
  );
}

function isStoredGameQuestion(value: unknown): value is StoredGameQuestion {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const question = value as Record<string, unknown>;
  return (
    typeof question.questionId === "string" &&
    typeof question.elementId === "number" &&
    typeof question.prompt === "string" &&
    typeof question.correctChoiceId === "string" &&
    Array.isArray(question.choices) &&
    question.choices.every(isStoredGameChoice)
  );
}

function parseStoredQuestions(value: unknown): StoredGameQuestion[] {
  if (!Array.isArray(value) || !value.every(isStoredGameQuestion)) {
    throw new Error("問題セットの形式が正しくありません");
  }

  return value;
}

function calculateQuestionScore(isCorrect: boolean, answerTimeSec: number): number {
  if (!isCorrect) {
    return 0;
  }

  return BASE_CORRECT_SCORE + (QUESTION_TIME_LIMIT_SEC - answerTimeSec) * TIME_BONUS_PER_SEC;
}

function calculateMaxStreak(results: readonly GameSessionResultItem[]): number {
  let currentStreak = 0;
  let maxStreak = 0;

  for (const result of results) {
    if (result.isCorrect) {
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return maxStreak;
}

function buildSessionResults({
  questions,
  answers,
}: {
  questions: readonly StoredGameQuestion[];
  answers: readonly SubmitGameSessionAnswer[];
}): GameSessionResultItem[] {
  validateAnswerSet({ questions, answers });
  const answersByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]));

  return questions.map((question) => {
    const answer = answersByQuestionId.get(question.questionId);
    if (!answer) {
      throw new GameSessionValidationError();
    }

    const correctChoice = question.choices.find(
      (choice) => choice.choiceId === question.correctChoiceId,
    );
    if (!correctChoice) {
      throw new Error("問題セットの形式が正しくありません");
    }

    const chosenChoice =
      answer.chosenChoiceId === null
        ? null
        : question.choices.find((choice) => choice.choiceId === answer.chosenChoiceId);
    if (answer.chosenChoiceId !== null && !chosenChoice) {
      throw new GameSessionValidationError();
    }

    const isCorrect =
      answer.chosenChoiceId !== null && answer.chosenChoiceId === correctChoice.choiceId;

    return {
      questionId: question.questionId,
      elementId: question.elementId,
      prompt: question.prompt,
      chosenChoiceId: answer.chosenChoiceId,
      isCorrect,
      correctAnswer: correctChoice.text,
      yourAnswer: chosenChoice?.text ?? null,
      answerTimeSec: answer.answerTimeSec,
      score: calculateQuestionScore(isCorrect, answer.answerTimeSec),
    };
  });
}

function validateAnswerSet({
  questions,
  answers,
}: {
  questions: readonly StoredGameQuestion[];
  answers: readonly SubmitGameSessionAnswer[];
}): void {
  if (answers.length !== questions.length) {
    throw new GameSessionValidationError();
  }

  const questionIds = new Set(questions.map((question) => question.questionId));
  const answeredQuestionIds = new Set<string>();

  for (const answer of answers) {
    if (!questionIds.has(answer.questionId) || answeredQuestionIds.has(answer.questionId)) {
      throw new GameSessionValidationError();
    }

    answeredQuestionIds.add(answer.questionId);
  }
}

async function updateWeakElementsForSession({
  tx,
  userId,
  results,
}: {
  tx: Prisma.TransactionClient;
  userId: string;
  results: readonly GameSessionResultItem[];
}): Promise<void> {
  for (const result of results) {
    if (!result.isCorrect) {
      await tx.weakElement.upsert({
        where: { userId_elementId: { userId, elementId: result.elementId } },
        create: { userId, elementId: result.elementId, missCount: 1, consecutiveHit: 0 },
        update: { missCount: { increment: 1 }, consecutiveHit: 0 },
      });
      continue;
    }

    const weakElement = await tx.weakElement.findUnique({
      where: { userId_elementId: { userId, elementId: result.elementId } },
    });

    if (!weakElement) {
      continue;
    }

    if (weakElement.consecutiveHit + 1 >= WEAK_ELEMENT_MASTERED_CONSECUTIVE_HIT_COUNT) {
      await tx.weakElement.delete({ where: { id: weakElement.id } });
      continue;
    }

    await tx.weakElement.update({
      where: { id: weakElement.id },
      data: { consecutiveHit: { increment: 1 } },
    });
  }
}

async function updateUserStatsForSession({
  tx,
  userId,
  totalScore,
  correctCount,
  totalCount,
  playedAt,
  masteredCount,
}: {
  tx: Prisma.TransactionClient;
  userId: string;
  totalScore: number;
  correctCount: number;
  totalCount: number;
  playedAt: Date;
  masteredCount: number;
}): Promise<void> {
  await tx.userStats.upsert({
    where: { userId },
    create: {
      userId,
      totalGames: 1,
      totalCorrect: correctCount,
      totalAnswered: totalCount,
      masteredCount,
      weeklyScore: totalScore,
      allTimeScore: totalScore,
      lastActiveDate: playedAt,
    },
    update: {
      totalGames: { increment: 1 },
      totalCorrect: { increment: correctCount },
      totalAnswered: { increment: totalCount },
      weeklyScore: { increment: totalScore },
      allTimeScore: { increment: totalScore },
      masteredCount,
      lastActiveDate: playedAt,
    },
  });
}

async function countMasteredElements({
  tx,
  userId,
}: {
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<number> {
  const masteryStatusMap = await getElementMasteryStatusMap(userId, ALL_ELEMENT_IDS, tx);

  return [...masteryStatusMap.values()].filter((status) => status === "mastered").length;
}

function buildStoredQuestions(
  mode: GameMode,
  candidates: readonly PrismaElement[],
  choiceIndexGenerator: () => number,
): StoredGameQuestion[] {
  if (candidates.length < GAME_CHOICE_COUNT) {
    throw new Error("問題を生成できません");
  }

  const answerWithSymbol = isNameToSymbolMode(mode);
  const questionElements = buildQuestionElements(candidates);

  return questionElements.map((element, index) => {
    const choices = buildChoices({
      candidates,
      correctElement: element,
      answerWithSymbol,
      correctChoiceIndex: choiceIndexGenerator(),
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
  choiceIndexGenerator = () => randomInt(0, GAME_CHOICE_COUNT),
}: CreateGameQuestionSetParams): Promise<CreateGameQuestionSetResult> {
  const candidates = await getCandidateElements(userId, mode);
  const questions = buildStoredQuestions(mode, candidates, choiceIndexGenerator);
  const questionsJson = toQuestionSetJson(questions);
  const expiresAt = new Date(now.getTime() + QUESTION_SET_EXPIRES_MS);

  const questionSet = await prisma.gameQuestionSet.create({
    data: {
      userId,
      mode,
      questions: questionsJson,
      expiresAt,
    },
  });

  return {
    questionSetId: questionSet.id,
    expiresAt: questionSet.expiresAt,
    questions: questions.map(toPublicQuestion),
  };
}

export async function submitGameSession({
  userId,
  questionSetId,
  mode,
  answers,
  durationSec,
  now = new Date(),
}: SubmitGameSessionParams): Promise<SubmitGameSessionResult> {
  return prisma.$transaction(async (tx) => {
    const questionSet = await tx.gameQuestionSet.findFirst({
      where: { id: questionSetId, userId },
    });

    if (!questionSet) {
      throw new QuestionSetNotFoundError();
    }

    if (questionSet.mode !== mode) {
      throw new QuestionSetModeMismatchError();
    }

    if (questionSet.expiresAt < now) {
      throw new QuestionSetExpiredError();
    }

    const questions = parseStoredQuestions(questionSet.questions);
    const results = buildSessionResults({ questions, answers });
    const totalScore = results.reduce((sum, result) => sum + result.score, 0);
    const correctCount = results.filter((result) => result.isCorrect).length;
    const maxStreak = calculateMaxStreak(results);

    const consumedQuestionSet = await tx.gameQuestionSet.deleteMany({
      where: { id: questionSetId, userId },
    });
    if (consumedQuestionSet.count !== 1) {
      throw new QuestionSetAlreadySubmittedError();
    }

    const session = await tx.gameSession.create({
      data: {
        userId,
        mode,
        totalScore,
        correctCount,
        totalCount: questions.length,
        maxStreak,
        durationSec,
        playedAt: now,
      },
    });

    await tx.gameAnswer.createMany({
      data: results.map((result) => ({
        sessionId: session.id,
        elementId: result.elementId,
        isCorrect: result.isCorrect,
        answerTimeSec: result.answerTimeSec,
      })),
    });

    await updateWeakElementsForSession({ tx, userId, results });
    const masteredCount = await countMasteredElements({ tx, userId });
    await updateUserStatsForSession({
      tx,
      userId,
      totalScore,
      correctCount,
      totalCount: questions.length,
      playedAt: now,
      masteredCount,
    });

    return {
      sessionId: session.id,
      mode,
      correctCount,
      totalCount: questions.length,
      totalScore,
      maxStreak,
      durationSec,
      playedAt: session.playedAt,
      results,
    };
  });
}
