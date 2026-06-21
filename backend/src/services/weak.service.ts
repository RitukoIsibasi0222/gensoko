import { prisma } from "../lib/prisma.js";

export type WeakElementListItem = {
  elementId: number;
  symbol: string;
  nameJa: string;
  missCount: number;
  addedAt: Date;
};

export async function getWeakElements(userId: string): Promise<WeakElementListItem[]> {
  const weakElements = await prisma.weakElement.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { addedAt: "desc" }],
    select: {
      elementId: true,
      missCount: true,
      addedAt: true,
      element: {
        select: {
          symbol: true,
          nameJa: true,
        },
      },
    },
  });

  return weakElements.map((weakElement) => ({
    elementId: weakElement.elementId,
    symbol: weakElement.element.symbol,
    nameJa: weakElement.element.nameJa,
    missCount: weakElement.missCount,
    addedAt: weakElement.addedAt,
  }));
}
