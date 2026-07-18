import { Hono } from "hono";
import { sign } from "hono/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppVariables } from "../../types/index.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../services/game.service.js", () => ({
  createGameQuestionSet: vi.fn(),
  getGameSessionResult: vi.fn(),
  submitGameSession: vi.fn(),
  GAME_SESSION_DURATION_LIMIT_SEC: 1800,
  QUESTION_TIME_LIMIT_SEC: 15,
  InsufficientWeakElementsError: class InsufficientWeakElementsError extends Error {
    constructor() {
      super("苦手モードを始めるには、苦手元素が5件以上必要です");
      this.name = "InsufficientWeakElementsError";
    }
  },
  GameSessionNotFoundError: class GameSessionNotFoundError extends Error {
    constructor() {
      super("ゲーム結果が見つかりません");
      this.name = "GameSessionNotFoundError";
    }
  },
  GameSessionValidationError: class GameSessionValidationError extends Error {
    constructor() {
      super("回答形式が正しくありません");
      this.name = "GameSessionValidationError";
    }
  },
  QuestionSetAlreadySubmittedError: class QuestionSetAlreadySubmittedError extends Error {
    constructor() {
      super("問題セットはすでに送信済みです");
      this.name = "QuestionSetAlreadySubmittedError";
    }
  },
  QuestionSetExpiredError: class QuestionSetExpiredError extends Error {
    constructor() {
      super("問題セットの有効期限が切れています。もう一度ゲームを開始してください");
      this.name = "QuestionSetExpiredError";
    }
  },
  QuestionSetModeMismatchError: class QuestionSetModeMismatchError extends Error {
    constructor() {
      super("問題セットのゲームモードが一致しません");
      this.name = "QuestionSetModeMismatchError";
    }
  },
  QuestionSetNotFoundError: class QuestionSetNotFoundError extends Error {
    constructor() {
      super("問題セットが見つかりません");
      this.name = "QuestionSetNotFoundError";
    }
  },
}));

import { prisma } from "../../lib/prisma.js";
import { InsufficientWeakElementsError } from "../../services/game.service.js";
import { createGameQuestionSet, createGameTestRouter } from "./test-helpers.js";

const TEST_SECRET = "test-secret-key-for-vitest";
const app = new Hono<{ Variables: AppVariables }>();
app.route("/game", createGameTestRouter(prisma as never, TEST_SECRET));

const createToken = async () => {
  return sign(
    {
      sub: "user-1",
      role: "USER",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    TEST_SECRET,
    "HS256",
  );
};

const mockActiveUser = {
  id: "user-1",
  role: "USER" as const,
  isActive: true,
  emailVerified: true,
  lockedUntil: null,
};

const mockQuestionSet = {
  questionSetId: "question-set-1",
  expiresAt: new Date("2026-06-20T12:30:00.000Z"),
  questions: [
    {
      questionId: "q1",
      prompt: "H",
      choices: [
        { choiceId: "1", text: "水素" },
        { choiceId: "6", text: "炭素" },
        { choiceId: "8", text: "酸素" },
        { choiceId: "7", text: "窒素" },
      ],
    },
  ],
};

describe("GET /game/questions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveUser as never);
    vi.mocked(createGameQuestionSet).mockResolvedValue(mockQuestionSet);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("認証済みユーザーに questionSetId と問題セットを200で返す", async () => {
    const token = await createToken();
    const res = await app.request("/game/questions?mode=SYMBOL_TO_NAME_LV1", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      questionSetId: "question-set-1",
      expiresAt: "2026-06-20T12:30:00.000Z",
      questions: mockQuestionSet.questions,
    });
    expect(createGameQuestionSet).toHaveBeenCalledWith({
      userId: "user-1",
      mode: "SYMBOL_TO_NAME_LV1",
    });
  });

  it("未認証なら401を返す", async () => {
    const res = await app.request("/game/questions?mode=SYMBOL_TO_NAME_LV1", {
      method: "GET",
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "認証が必要です" });
    expect(createGameQuestionSet).not.toHaveBeenCalled();
  });

  it("mode が不正なら400を返す", async () => {
    const token = await createToken();
    const res = await app.request("/game/questions?mode=UNKNOWN", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("バリデーションエラー");
    expect(createGameQuestionSet).not.toHaveBeenCalled();
  });

  it("mode が未指定なら400で具体的なバリデーションメッセージを返す", async () => {
    const token = await createToken();
    const res = await app.request("/game/questions", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("バリデーションエラー");
    expect(body.details[0].message).toBe("ゲームモードが正しくありません");
    expect(createGameQuestionSet).not.toHaveBeenCalled();
  });

  it("レスポンスの問題と選択肢から正解情報を公開しない", async () => {
    vi.mocked(createGameQuestionSet).mockResolvedValue({
      ...mockQuestionSet,
      questions: [
        {
          questionId: "q1",
          prompt: "H",
          correctChoiceId: "1",
          elementId: 1,
          choices: [
            { choiceId: "1", elementId: 1, text: "水素" },
            { choiceId: "6", elementId: 6, text: "炭素" },
            { choiceId: "8", elementId: 8, text: "酸素" },
            { choiceId: "7", elementId: 7, text: "窒素" },
          ],
        },
      ],
    } as never);
    const token = await createToken();

    const res = await app.request("/game/questions?mode=SYMBOL_TO_NAME_LV1", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions[0]).toEqual({
      questionId: "q1",
      prompt: "H",
      choices: [
        { choiceId: "1", text: "水素" },
        { choiceId: "6", text: "炭素" },
        { choiceId: "8", text: "酸素" },
        { choiceId: "7", text: "窒素" },
      ],
    });
    expect(body.questions[0]).not.toHaveProperty("correctChoiceId");
    expect(body.questions[0]).not.toHaveProperty("elementId");
    expect(body.questions[0].choices[0]).not.toHaveProperty("elementId");
  });

  it("苦手元素が不足している場合は409を返す", async () => {
    vi.mocked(createGameQuestionSet).mockRejectedValue(new InsufficientWeakElementsError());
    const token = await createToken();
    const res = await app.request("/game/questions?mode=WEAK_SYMBOL_TO_NAME", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "苦手モードを始めるには、苦手元素が5件以上必要です",
    });
  });

  it("予期しないエラーでは500を返す", async () => {
    vi.mocked(createGameQuestionSet).mockRejectedValue(new Error("db error"));
    const token = await createToken();
    const res = await app.request("/game/questions?mode=SYMBOL_TO_NAME_LV1", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "サーバーエラーが発生しました" });
  });
});
