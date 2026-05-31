import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    element: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../lib/prisma.js";
import { elementsRouter } from "./index.js";

const app = new Hono();
app.route("/elements", elementsRouter);

describe("GET /elements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("元素一覧を200で返す", async () => {
    vi.mocked(prisma.element.findMany).mockResolvedValue([
      {
        id: 1,
        symbol: "H",
        nameJa: "水素",
        nameEn: "Hydrogen",
        category: "非金属",
        period: 1,
        group: 1,
        atomicWeight: 1.008,
        etymology: "由来",
      },
      {
        id: 2,
        symbol: "He",
        nameJa: "ヘリウム",
        nameEn: "Helium",
        category: "希ガス",
        period: 1,
        group: 18,
        atomicWeight: 4.003,
        etymology: null,
      },
    ]);

    const res = await app.request("/elements", { method: "GET" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      elements: [
        {
          id: 1,
          symbol: "H",
          nameJa: "水素",
          nameEn: "Hydrogen",
          category: "非金属",
          period: 1,
          group: 1,
          atomicWeight: 1.008,
          etymology: "由来",
        },
        {
          id: 2,
          symbol: "He",
          nameJa: "ヘリウム",
          nameEn: "Helium",
          category: "希ガス",
          period: 1,
          group: 18,
          atomicWeight: 4.003,
          etymology: null,
        },
      ],
    });
    expect(prisma.element.findMany).toHaveBeenCalledWith({
      orderBy: { id: "asc" },
    });
  });

  it("予期しないエラー時は500を返す", async () => {
    vi.mocked(prisma.element.findMany).mockRejectedValue(new Error("unexpected"));

    const res = await app.request("/elements", { method: "GET" });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "サーバーエラーが発生しました" });
  });
});
