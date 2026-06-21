import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    weakElement: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../lib/prisma.js";
import { getWeakElements } from "./weak.service.js";

const WEAK_ELEMENT_ROWS = [
  {
    elementId: 26,
    missCount: 3,
    addedAt: new Date("2026-05-01T00:00:00.000Z"),
    element: {
      symbol: "Fe",
      nameJa: "鉄",
    },
  },
  {
    elementId: 8,
    missCount: 1,
    addedAt: new Date("2026-04-20T00:00:00.000Z"),
    element: {
      symbol: "O",
      nameJa: "酸素",
    },
  },
];

describe("getWeakElements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ログインユーザーの苦手元素だけを取得する", async () => {
    vi.mocked(prisma.weakElement.findMany).mockResolvedValue(WEAK_ELEMENT_ROWS as never);

    await getWeakElements("user-1");

    expect(prisma.weakElement.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
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
  });

  it("公開フィールドだけに整形して返す", async () => {
    vi.mocked(prisma.weakElement.findMany).mockResolvedValue(WEAK_ELEMENT_ROWS as never);

    const result = await getWeakElements("user-1");

    expect(result).toEqual([
      {
        elementId: 26,
        symbol: "Fe",
        nameJa: "鉄",
        missCount: 3,
        addedAt: new Date("2026-05-01T00:00:00.000Z"),
      },
      {
        elementId: 8,
        symbol: "O",
        nameJa: "酸素",
        missCount: 1,
        addedAt: new Date("2026-04-20T00:00:00.000Z"),
      },
    ]);
  });

  it("苦手元素がない場合は空配列を返す", async () => {
    vi.mocked(prisma.weakElement.findMany).mockResolvedValue([]);

    const result = await getWeakElements("user-1");

    expect(result).toEqual([]);
  });
});
