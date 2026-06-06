import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { buildElementWhereInput, elementSearchQuerySchema } from "../../lib/elements/search.js";
import { prisma } from "../../lib/prisma.js";
import { optionalAuthMiddleware } from "../../middleware/auth/index.js";
import { getElementMasteryStatusMap } from "../../services/element-mastery.service.js";
import type { AppVariables } from "../../types/index.js";

export const elementsRouter = new Hono<{ Variables: AppVariables }>();

elementsRouter.get(
  "/",
  zValidator("query", elementSearchQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
    }
  }),
  optionalAuthMiddleware,
  async (c) => {
    const query = c.req.valid("query");
    const where = buildElementWhereInput(query);

    try {
      const elements = await prisma.element.findMany({
        ...(where === undefined ? {} : { where }),
        orderBy: { id: "asc" },
      });

      const user = c.get("user");
      if (user) {
        const masteryStatusMap = await getElementMasteryStatusMap(
          user.id,
          elements.map((element) => element.id),
        );
        return c.json(
          {
            elements: elements.map((element) => ({
              ...element,
              masteryStatus: masteryStatusMap.get(element.id) ?? "unlearned",
            })),
          },
          200,
        );
      }

      return c.json({ elements }, 200);
    } catch {
      return c.json({ error: "サーバーエラーが発生しました" }, 500);
    }
  },
);
