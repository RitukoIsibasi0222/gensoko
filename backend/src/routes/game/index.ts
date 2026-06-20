import { zValidator } from "@hono/zod-validator";
import type { GameMode } from "@prisma/client";
import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../../middleware/auth/index.js";
import { rateLimit } from "../../middleware/rateLimit/index.js";
import {
  createGameQuestionSet,
  GameSessionValidationError,
  InsufficientWeakElementsError,
  QuestionSetAlreadySubmittedError,
  QuestionSetExpiredError,
  QuestionSetModeMismatchError,
  QuestionSetNotFoundError,
  submitGameSession,
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
const QUESTION_SET_ID_ERROR_MESSAGE = "問題セットIDが正しくありません";
const ANSWER_FORMAT_ERROR_MESSAGE = "回答形式が正しくありません";
const DURATION_ERROR_MESSAGE = "回答時間が正しくありません";

const gameQuestionsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  trustProxy: process.env.TRUST_PROXY === "true",
});

const gameSessionsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  trustProxy: process.env.TRUST_PROXY === "true",
});

export const gameQuestionsQuerySchema = z
  .object({
    mode: z.enum(GAME_MODE_VALUES, { message: GAME_MODE_ERROR_MESSAGE }),
  })
  .strip();

export const gameSessionBodySchema = z
  .object({
    questionSetId: z.string().trim().min(1, { message: QUESTION_SET_ID_ERROR_MESSAGE }),
    mode: z.enum(GAME_MODE_VALUES, { message: GAME_MODE_ERROR_MESSAGE }),
    answers: z
      .array(
        z
          .object({
            questionId: z.string().trim().min(1, { message: ANSWER_FORMAT_ERROR_MESSAGE }),
            chosenChoiceId: z
              .string()
              .trim()
              .min(1, { message: ANSWER_FORMAT_ERROR_MESSAGE })
              .nullable(),
            answerTimeSec: z
              .number()
              .int({ message: DURATION_ERROR_MESSAGE })
              .min(0, { message: DURATION_ERROR_MESSAGE })
              .max(15, { message: DURATION_ERROR_MESSAGE }),
          })
          .strip(),
      )
      .min(1, { message: ANSWER_FORMAT_ERROR_MESSAGE }),
    durationSec: z
      .number()
      .int({ message: DURATION_ERROR_MESSAGE })
      .min(0, { message: DURATION_ERROR_MESSAGE })
      .max(1800, { message: DURATION_ERROR_MESSAGE }),
  })
  .strip();

export const gameRouter = new Hono<{ Variables: AppVariables }>();

gameRouter.get(
  "/questions",
  gameQuestionsRateLimit,
  authMiddleware,
  zValidator("query", gameQuestionsQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const { mode } = c.req.valid("query");
    const user = c.get("user")!;

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

gameRouter.post(
  "/sessions",
  gameSessionsRateLimit,
  authMiddleware,
  zValidator("json", gameSessionBodySchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user")!;

    try {
      const session = await submitGameSession({
        userId: user.id,
        questionSetId: body.questionSetId,
        mode: body.mode,
        answers: body.answers,
        durationSec: body.durationSec,
      });

      return c.json(
        {
          ...session,
          playedAt: session.playedAt.toISOString(),
        },
        201,
      );
    } catch (error) {
      if (error instanceof GameSessionValidationError) {
        return c.json({ error: error.message }, 400);
      }

      if (error instanceof QuestionSetNotFoundError) {
        return c.json({ error: error.message }, 404);
      }

      if (
        error instanceof QuestionSetAlreadySubmittedError ||
        error instanceof QuestionSetExpiredError ||
        error instanceof QuestionSetModeMismatchError
      ) {
        return c.json({ error: error.message }, 409);
      }

      return c.json({ error: "サーバーエラーが発生しました" }, 500);
    }
  },
);
