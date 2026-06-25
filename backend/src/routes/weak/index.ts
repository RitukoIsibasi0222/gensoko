import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { isDecimalIntegerString } from "../../lib/elements/number.js";
import { ELEMENT_ID_SEARCH_MAX, ELEMENT_ID_SEARCH_MIN } from "../../lib/elements/search.js";
import { authMiddleware } from "../../middleware/auth/index.js";
import {
  deleteWeakElement,
  getWeakElements,
  WeakElementNotFoundError,
} from "../../services/weak.service.js";
import type { AppVariables } from "../../types/index.js";

const ELEMENT_ID_ERROR_MESSAGE =
  "元素IDは" + ELEMENT_ID_SEARCH_MIN + "から" + ELEMENT_ID_SEARCH_MAX + "の整数で指定してください";

function normalizeElementId(value: unknown, ctx: z.RefinementCtx): number {
  if (typeof value !== "string" && typeof value !== "number") {
    ctx.addIssue({
      code: "custom",
      message: ELEMENT_ID_ERROR_MESSAGE,
    });
    return z.NEVER;
  }

  const rawElementId = typeof value === "string" ? value.trim() : value;
  if (rawElementId === "") {
    ctx.addIssue({
      code: "custom",
      message: ELEMENT_ID_ERROR_MESSAGE,
    });
    return z.NEVER;
  }

  if (typeof rawElementId === "string" && !isDecimalIntegerString(rawElementId)) {
    ctx.addIssue({
      code: "custom",
      message: ELEMENT_ID_ERROR_MESSAGE,
    });
    return z.NEVER;
  }

  const elementId = typeof rawElementId === "number" ? rawElementId : Number(rawElementId);
  if (
    !Number.isInteger(elementId) ||
    elementId < ELEMENT_ID_SEARCH_MIN ||
    elementId > ELEMENT_ID_SEARCH_MAX
  ) {
    ctx.addIssue({
      code: "custom",
      message: ELEMENT_ID_ERROR_MESSAGE,
    });
    return z.NEVER;
  }

  return elementId;
}

const weakElementIdParamSchema = z
  .object({
    elementId: z.unknown().transform(normalizeElementId),
  })
  .strip();

export const weakRouter = new Hono<{ Variables: AppVariables }>();

weakRouter.get("/", authMiddleware, async (c) => {
  const user = c.get("user")!;

  try {
    const weakElements = await getWeakElements(user.id);

    return c.json(
      {
        weakElements: weakElements.map((weakElement) => ({
          ...weakElement,
          addedAt: weakElement.addedAt.toISOString(),
        })),
      },
      200,
    );
  } catch {
    return c.json({ error: "サーバーエラーが発生しました" }, 500);
  }
});

weakRouter.delete(
  "/:elementId",
  authMiddleware,
  zValidator("param", weakElementIdParamSchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
    }
  }),
  async (c) => {
    const { elementId } = c.req.valid("param");
    const user = c.get("user")!;

    try {
      await deleteWeakElement({ userId: user.id, elementId });

      return c.json({ message: "苦手リストから削除しました" }, 200);
    } catch (error) {
      if (error instanceof WeakElementNotFoundError) {
        return c.json({ error: error.message }, 404);
      }

      return c.json({ error: "サーバーエラーが発生しました" }, 500);
    }
  },
);
