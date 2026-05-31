import { Hono } from "hono";
import { prisma } from "../../lib/prisma.js";

export const elementsRouter = new Hono();

elementsRouter.get("/", async (c) => {
  try {
    const elements = await prisma.element.findMany({
      orderBy: { id: "asc" },
    });

    return c.json({ elements }, 200);
  } catch {
    return c.json({ error: "サーバーエラーが発生しました" }, 500);
  }
});
