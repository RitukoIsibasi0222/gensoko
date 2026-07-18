import { zValidator } from "@hono/zod-validator";
import type { GameMode } from "@prisma/client";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  createIpBucketResolver,
  createUserBucketResolver,
  getRateLimitStore,
} from "../../middleware/rateLimit/buckets.js";
import { rateLimit } from "../../middleware/rateLimit/index.js";
import {
  GAME_SESSION_DURATION_LIMIT_SEC,
  GameSessionHistoryCursorError,
  GameSessionNotFoundError,
  GameSessionValidationError,
  type GameService,
  InsufficientWeakElementsError,
  type PublicGameQuestion,
  QUESTION_TIME_LIMIT_SEC,
  QuestionSetAlreadySubmittedError,
  QuestionSetExpiredError,
  QuestionSetModeMismatchError,
  QuestionSetNotFoundError,
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
const SESSION_ID_ERROR_MESSAGE = "セッションIDが正しくありません";
const ANSWER_FORMAT_ERROR_MESSAGE = "回答形式が正しくありません";
const DURATION_ERROR_MESSAGE = "回答時間が正しくありません";

const gameQuestionsRateLimit = rateLimit({
  getStore: getRateLimitStore,
  resolveBuckets: createIpBucketResolver("GAME_QUESTIONS_IP"),
});

const gameSubmitIpRateLimit = rateLimit({
  getStore: getRateLimitStore,
  resolveBuckets: createIpBucketResolver("GAME_SUBMIT_IP"),
});

const gameSubmitUserRateLimit = rateLimit({
  getStore: getRateLimitStore,
  resolveBuckets: createUserBucketResolver("GAME_SUBMIT_USER"),
});

export const gameQuestionsQuerySchema = z
  .object({
    mode: z.enum(GAME_MODE_VALUES, { message: GAME_MODE_ERROR_MESSAGE }),
  })
  .strip();

function toPublicGameQuestionResponse(question: PublicGameQuestion): PublicGameQuestion {
  return {
    questionId: question.questionId,
    prompt: question.prompt,
    choices: question.choices.map((choice) => ({
      choiceId: choice.choiceId,
      text: choice.text,
    })),
  };
}

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
              .max(QUESTION_TIME_LIMIT_SEC, { message: DURATION_ERROR_MESSAGE }),
          })
          .strip(),
      )
      .min(1, { message: ANSWER_FORMAT_ERROR_MESSAGE }),
    durationSec: z
      .number()
      .int({ message: DURATION_ERROR_MESSAGE })
      .min(0, { message: DURATION_ERROR_MESSAGE })
      .max(GAME_SESSION_DURATION_LIMIT_SEC, { message: DURATION_ERROR_MESSAGE }),
  })
  .strip();

export const gameSessionParamsSchema = z
  .object({
    sessionId: z.string().trim().min(1, { message: SESSION_ID_ERROR_MESSAGE }),
  })
  .strip();

const SESSION_HISTORY_DEFAULT_LIMIT = 20;
const SESSION_HISTORY_MAX_LIMIT = 50;
const SESSION_HISTORY_LIMIT_ERROR_MESSAGE = "取得件数が正しくありません";
const SESSION_HISTORY_CURSOR_ERROR_MESSAGE = "カーソルが正しくありません";

const optionalTrimmedString = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    return value.trim();
  },
  z.string({ message: SESSION_HISTORY_CURSOR_ERROR_MESSAGE }),
);

export const gameSessionHistoryQuerySchema = z
  .object({
    limit: z.preprocess(
      (value) => {
        if (value === undefined) {
          return SESSION_HISTORY_DEFAULT_LIMIT;
        }

        if (typeof value === "string") {
          const normalizedLimit = value.trim();
          if (normalizedLimit.length === 0) {
            return SESSION_HISTORY_DEFAULT_LIMIT;
          }

          return Number(normalizedLimit);
        }

        return Number(value);
      },
      z
        .number({ message: SESSION_HISTORY_LIMIT_ERROR_MESSAGE })
        .int({ message: SESSION_HISTORY_LIMIT_ERROR_MESSAGE })
        .min(1, { message: SESSION_HISTORY_LIMIT_ERROR_MESSAGE })
        .max(SESSION_HISTORY_MAX_LIMIT, { message: SESSION_HISTORY_LIMIT_ERROR_MESSAGE }),
    ),
    cursor: optionalTrimmedString
      .pipe(z.string().min(1, { message: SESSION_HISTORY_CURSOR_ERROR_MESSAGE }))
      .optional(),
    mode: z.enum(GAME_MODE_VALUES, { message: GAME_MODE_ERROR_MESSAGE }).optional(),
  })
  .strip();

export type GameRouterDependencies = Readonly<{
  authMiddleware: MiddlewareHandler<{ Variables: AppVariables }>;
  service: GameService;
}>;

export function createGameRouter({ authMiddleware, service }: GameRouterDependencies) {
  const gameRouter = new Hono<{ Variables: AppVariables }>();

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
        const questionSet = await service.createGameQuestionSet({
          userId: user.id,
          mode,
        });

        return c.json(
          {
            questionSetId: questionSet.questionSetId,
            expiresAt: questionSet.expiresAt.toISOString(),
            questions: questionSet.questions.map(toPublicGameQuestionResponse),
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

  gameRouter.get(
    "/sessions/:sessionId",
    authMiddleware,
    zValidator("param", gameSessionParamsSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
      }
    }),
    async (c) => {
      const { sessionId } = c.req.valid("param");
      const user = c.get("user")!;

      try {
        const session = await service.getGameSessionResult({
          userId: user.id,
          sessionId,
        });

        return c.json(
          {
            ...session,
            playedAt: session.playedAt.toISOString(),
          },
          200,
        );
      } catch (error) {
        if (error instanceof GameSessionNotFoundError) {
          return c.json({ error: error.message }, 404);
        }

        return c.json({ error: "サーバーエラーが発生しました" }, 500);
      }
    },
  );

  gameRouter.post(
    "/sessions",
    gameSubmitIpRateLimit,
    authMiddleware,
    gameSubmitUserRateLimit,
    zValidator("json", gameSessionBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
      }
    }),
    async (c) => {
      const body = c.req.valid("json");
      const user = c.get("user")!;

      try {
        const session = await service.submitGameSession({
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

  gameRouter.get(
    "/sessions",
    authMiddleware,
    zValidator("query", gameSessionHistoryQuerySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
      }
    }),
    async (c) => {
      const query = c.req.valid("query");
      const user = c.get("user")!;

      try {
        const history = await service.getGameSessionHistory({
          userId: user.id,
          limit: query.limit,
          cursor: query.cursor,
          mode: query.mode,
        });

        return c.json(
          {
            sessions: history.sessions.map((session) => ({
              ...session,
              playedAt: session.playedAt.toISOString(),
            })),
            nextCursor: history.nextCursor,
          },
          200,
        );
      } catch (error) {
        if (error instanceof GameSessionHistoryCursorError) {
          return c.json(
            {
              error: "バリデーションエラー",
              details: [{ message: error.message }],
            },
            400,
          );
        }

        return c.json({ error: "サーバーエラーが発生しました" }, 500);
      }
    },
  );

  return gameRouter;
}
