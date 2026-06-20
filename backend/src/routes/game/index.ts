import { zValidator } from "@hono/zod-validator";
import type { GameMode } from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth/index.js";
import { rateLimit } from "../../middleware/rateLimit/index.js";
import {
  createGameQuestionSet,
  InsufficientWeakElementsError,
} from "../../services/game.service.js";
import type { AppVariables } from "../../types/index.js";

const GAME_MODE_VALUES = [
  "SYMBOL_TO_NAME_LV1",
  "SYMBOL_TO_NAME_LV2",
  "NAME_TO_SYMBOL_LV1",
  "NAME_TO_SYMBOL_LV2",
  "WEAK_SYMBOL_TO_NAME",
  "WEAK_NAME_TO_SYMBOL",
] as const satisfies readonly GameMode[];

const GAME_MODE_ERROR_MESSAGE = "ゲームモードが正しくありません";

export const gameQuestionsQuerySchema = z
  .object({
    mode: z.enum(GAME_MODE_VALUES, { error: GAME_MODE_ERROR_MESSAGE }),
  })
  .strip();

export const gameRouter = new Hono<{ Variables: AppVariables }>();

gameRouter.get(
  "/questions",
  rateLimit({ windowMs: 60 * 1000, max: 30 }),
  authMiddleware,
  zValidator("query", gameQuestionsQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const { mode } = c.req.valid("query");
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "認証が必要です" }, 401);
    }

    try {
      const questionSet = await createGameQuestionSet({
        userId: user.id,
        mode,
      });

      return c.json(
        {
          questionSetId: questionSet.questionSetId,
          expiresAt: questionSet.expiresAt.toISOString(),
          questions: questionSet.questions,
        },
        200,
      );
    } catch (error) {
      if (error instanceof InsufficientWeakElementsError) {
        return c.json({ error: error.message }, 409);
      }

      return c.json({ error: "サーバーエラーが発生しました" }, 500);
    }
  },
);
