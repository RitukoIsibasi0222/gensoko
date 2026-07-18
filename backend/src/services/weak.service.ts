import type { AppPrismaClient } from "../lib/prisma-client.js";

export type WeakElementListItem = {
  elementId: number;
  symbol: string;
  nameJa: string;
  missCount: number;
  addedAt: Date;
};

export type DeleteWeakElementParams = {
  userId: string;
  elementId: number;
};

export class WeakElementNotFoundError extends Error {
  constructor() {
    super("苦手元素が見つかりません");
    this.name = "WeakElementNotFoundError";
  }
}

export function createWeakService(prisma: AppPrismaClient) {
  async function getWeakElements(userId: string): Promise<WeakElementListItem[]> {
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

  async function deleteWeakElement({ userId, elementId }: DeleteWeakElementParams): Promise<void> {
    const result = await prisma.weakElement.deleteMany({
      where: { userId, elementId },
    });

    if (result.count === 0) {
      throw new WeakElementNotFoundError();
    }
  }

  return { getWeakElements, deleteWeakElement };
}

export type WeakService = ReturnType<typeof createWeakService>;
