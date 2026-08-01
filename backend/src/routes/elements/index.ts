import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";
import { elementIdParamSchema } from "../../lib/elements/detail.js";
import { buildElementWhereInput, elementSearchQuerySchema } from "../../lib/elements/search.js";
import type { AppPrismaClient } from "../../lib/prisma-client.js";
import type { ElementMasteryService } from "../../services/element-mastery.service.js";
import type { AppVariables } from "../../types/index.js";

export type ElementsRouterDependencies = Readonly<{
  prisma: Pick<AppPrismaClient, "element">;
  optionalAuthMiddleware: MiddlewareHandler<{ Variables: AppVariables }>;
  masteryService: ElementMasteryService;
}>;

export function createElementsRouter({
  prisma,
  optionalAuthMiddleware,
  masteryService,
}: ElementsRouterDependencies) {
  const elementsRouter = new Hono<{ Variables: AppVariables }>();

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
          const masteryStatusMap = await masteryService.getElementMasteryStatusMap(
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

  elementsRouter.get(
    "/:id",
    zValidator("param", elementIdParamSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: "バリデーションエラー", details: result.error.issues }, 400);
      }
    }),
    async (c) => {
      const { id } = c.req.valid("param");

      try {
        const element = await prisma.element.findUnique({
          where: { id },
        });

        if (element === null) {
          return c.json({ error: "元素が見つかりません" }, 404);
        }

        return c.json({ element }, 200);
      } catch {
        return c.json({ error: "サーバーエラーが発生しました" }, 500);
      }
    },
  );

  return elementsRouter;
}
