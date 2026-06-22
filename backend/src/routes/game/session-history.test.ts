import { Hono } from "hono";
import { sign } from "hono/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppVariables } from "../../types/index.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock("../../services/game.service.js", () => ({
  createGameQuestionSet: vi.fn(),
  getGameSessionHistory: vi.fn(),
  getGameSessionResult: vi.fn(),
  submitGameSession: vi.fn(),
  GAME_SESSION_DURATION_LIMIT_SEC: 1800,
  QUESTION_TIME_LIMIT_SEC: 15,
  GameSessionHistoryCursorError: class GameSessionHistoryCursorError extends Error {
    constructor() {
      super("カーソルが正しくありません");
      this.name = "GameSessionHistoryCursorError";
    }
  },
  InsufficientWeakElementsError: class InsufficientWeakElementsError extends Error {},
  GameSessionNotFoundError: class GameSessionNotFoundError extends Error {},
  GameSessionValidationError: class GameSessionValidationError extends Error {},
  QuestionSetAlreadySubmittedError: class QuestionSetAlreadySubmittedError extends Error {},
  QuestionSetExpiredError: class QuestionSetExpiredError extends Error {},
  QuestionSetModeMismatchError: class QuestionSetModeMismatchError extends Error {},
  QuestionSetNotFoundError: class QuestionSetNotFoundError extends Error {},
}));

import { prisma } from "../../lib/prisma.js";
import {
  GameSessionHistoryCursorError,
  getGameSessionHistory,
} from "../../services/game.service.js";
import { gameRouter } from "./index.js";

const app = new Hono<{ Variables: AppVariables }>();
app.route("/game", gameRouter);

const TEST_SECRET = "test-secret-key-for-vitest";
const mockActiveUser = {
  id: "user-1",
  role: "USER" as const,
  isActive: true,
  emailVerified: true,
  lockedUntil: null,
};
const mockHistoryResult = {
  sessions: [
    {
      sessionId: "session-1",
      mode: "SYMBOL_TO_NAME_LV1" as const,
      correctCount: 8,
      totalCount: 10,
      totalScore: 800,
      maxStreak: 5,
      durationSec: 72,
      playedAt: new Date("2026-06-20T12:35:00.000Z"),
    },
  ],
  nextCursor: null,
};

const createToken = async () =>
  sign(
    { sub: "user-1", role: "USER", exp: Math.floor(Date.now() / 1000) + 3600 },
    TEST_SECRET,
    "HS256",
  );

describe("GET /game/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveUser as never);
    vi.mocked(getGameSessionHistory).mockResolvedValue(mockHistoryResult);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("未認証なら401を返す", async () => {
    const res = await app.request("/game/sessions", { method: "GET" });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "認証が必要です" });
    expect(getGameSessionHistory).not.toHaveBeenCalled();
  });

  it("query が不正なら400を返す", async () => {
    const token = await createToken();
    const res = await app.request("/game/sessions?limit=0&mode=UNKNOWN&cursor=", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("バリデーションエラー");
    expect(body.details.length).toBeGreaterThan(0);
    expect(getGameSessionHistory).not.toHaveBeenCalled();
  });

  it("認証済みユーザーの履歴一覧を200で返す", async () => {
    const token = await createToken();
    const res = await app.request(
      "/game/sessions?limit=10&cursor=session-cursor&mode=SYMBOL_TO_NAME_LV1",
      {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sessions: [{ ...mockHistoryResult.sessions[0], playedAt: "2026-06-20T12:35:00.000Z" }],
      nextCursor: null,
    });
    expect(getGameSessionHistory).toHaveBeenCalledWith({
      userId: "user-1",
      limit: 10,
      cursor: "session-cursor",
      mode: "SYMBOL_TO_NAME_LV1",
    });
  });

  it("query 未指定なら既定値で取得する", async () => {
    const token = await createToken();
    const res = await app.request("/game/sessions", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
    expect(getGameSessionHistory).toHaveBeenCalledWith({
      userId: "user-1",
      limit: 20,
      cursor: undefined,
      mode: undefined,
    });
  });

  it("limit が空白だけなら既定値で取得する", async () => {
    const token = await createToken();
    const res = await app.request("/game/sessions?limit=%20", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
    expect(getGameSessionHistory).toHaveBeenCalledWith({
      userId: "user-1",
      limit: 20,
      cursor: undefined,
      mode: undefined,
    });
  });

  it("service が cursor error を投げたら400を返す", async () => {
    vi.mocked(getGameSessionHistory).mockRejectedValue(new GameSessionHistoryCursorError());
    const token = await createToken();
    const res = await app.request("/game/sessions?cursor=missing", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "バリデーションエラー",
      details: [{ message: "カーソルが正しくありません" }],
    });
  });
});
