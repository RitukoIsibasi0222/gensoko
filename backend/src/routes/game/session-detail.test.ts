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
import { GameSessionNotFoundError } from "../../services/game.service.js";
import { createGameTestRouter, getGameSessionResult } from "./test-helpers.js";

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

const mockSessionResult = {
  sessionId: "session-1",
  mode: "SYMBOL_TO_NAME_LV1" as const,
  correctCount: 1,
  totalCount: 2,
  totalScore: 100,
  maxStreak: 1,
  durationSec: 20,
  playedAt: new Date("2026-06-20T12:35:00.000Z"),
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
};

describe("GET /game/sessions/:sessionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveUser as never);
    vi.mocked(getGameSessionResult).mockResolvedValue(mockSessionResult);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("未認証なら401を返す", async () => {
    const res = await app.request("/game/sessions/session-1", {
      method: "GET",
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "認証が必要です" });
    expect(getGameSessionResult).not.toHaveBeenCalled();
  });

  it("sessionId が空白なら400を返す", async () => {
    const token = await createToken();
    const res = await app.request("/game/sessions/%20%20%20", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("バリデーションエラー");
    expect(body.details.length).toBeGreaterThan(0);
    expect(getGameSessionResult).not.toHaveBeenCalled();
  });

  it("認証済みユーザーに保存済みゲーム結果を200で返す", async () => {
    const token = await createToken();
    const res = await app.request("/game/sessions/session-1", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...mockSessionResult,
      playedAt: "2026-06-20T12:35:00.000Z",
    });
    expect(getGameSessionResult).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-1",
    });
  });

  it("service が GameSessionNotFoundError を投げたら404を返す", async () => {
    vi.mocked(getGameSessionResult).mockRejectedValue(new GameSessionNotFoundError());
    const token = await createToken();
    const res = await app.request("/game/sessions/missing-session", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "ゲーム結果が見つかりません" });
    expect(getGameSessionResult).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "missing-session",
    });
  });

  it("予期しないエラーでは500を返す", async () => {
    vi.mocked(getGameSessionResult).mockRejectedValue(new Error("db error"));
    const token = await createToken();
    const res = await app.request("/game/sessions/session-1", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "サーバーエラーが発生しました" });
  });
});
