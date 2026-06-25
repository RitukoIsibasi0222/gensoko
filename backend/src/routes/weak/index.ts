import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { elementIdParamSchema } from "../../lib/elements/detail.js";
import { authMiddleware } from "../../middleware/auth/index.js";
import {
  deleteWeakElement,
  getWeakElements,
  WeakElementNotFoundError,
} from "../../services/weak.service.js";
import type { AppVariables } from "../../types/index.js";

const weakElementIdParamSchema = z
  .object({
    elementId: z.unknown(),
  })
  .strip()
  .transform(({ elementId }) => ({ id: elementId }))
  .pipe(elementIdParamSchema)
  .transform(({ id }) => ({ elementId: id }));

function toWeakElementValidationIssues(issues: z.ZodIssue[]): z.ZodIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path.map((pathSegment) => (pathSegment === "id" ? "elementId" : pathSegment)),
  }));
}

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
      return c.json(
        {
          error: "バリデーションエラー",
          details: toWeakElementValidationIssues(result.error.issues),
        },
        400,
      );
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
