import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth/index.js";
import { getWeakElements } from "../../services/weak.service.js";
import type { AppVariables } from "../../types/index.js";

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
