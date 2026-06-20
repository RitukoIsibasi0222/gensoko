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
  InsufficientWeakElementsError: class InsufficientWeakElementsError extends Error {
    constructor() {
      super("苦手モードを始めるには、苦手元素が5件以上必要です");
      this.name = "InsufficientWeakElementsError";
    }
  },
}));

import { prisma } from "../../lib/prisma.js";
import {
  createGameQuestionSet,
  InsufficientWeakElementsError,
} from "../../services/game.service.js";
import { gameRouter } from "./index.js";

const app = new Hono<{ Variables: AppVariables }>();
app.route("/game", gameRouter);

const TEST_SECRET = "test-secret-key-for-vitest";

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
