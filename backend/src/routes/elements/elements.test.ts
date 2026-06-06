import { Hono } from "hono";
import { sign } from "hono/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getElementIdsMatchingKeyword } from "../../lib/elements/search.js";
import type { AppVariables } from "../../types/index.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    element: {
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    gameSession: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../lib/prisma.js";
import { elementsRouter } from "./index.js";

const app = new Hono<{ Variables: AppVariables }>();
app.route("/elements", elementsRouter);

const TEST_SECRET = "test-secret-key-for-vitest";

const createToken = async () => {
  return sign(
    {
      sub: "user-1",
      role: "USER",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    TEST_SECRET,
    "HS256",
  );
};

const mockActiveUser = {
  id: "user-1",
  role: "USER" as const,
  isActive: true,
  emailVerified: true,
  lockedUntil: null,
};

describe("GET /elements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it("ログイン時は各元素に masteryStatus を付与して200で返す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveUser as never);
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
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([
      {
        playedAt: new Date("2026-06-02T00:00:00.000Z"),
        answers: [{ elementId: 1, isCorrect: true }],
      },
      {
        playedAt: new Date("2026-06-01T00:00:00.000Z"),
        answers: [{ elementId: 1, isCorrect: true }],
      },
    ] as never);

    const token = await createToken();
    const res = await app.request("/elements", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

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
          masteryStatus: "mastered",
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
          masteryStatus: "unlearned",
        },
      ],
    });
    expect(prisma.gameSession.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: [{ playedAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 50,
      select: {
        answers: {
          where: {
            elementId: { in: [1, 2] },
          },
          select: {
            elementId: true,
            isCorrect: true,
          },
        },
      },
    });
  });

  it("q で番号・記号・日本語名・英語名の OR 検索を行う", async () => {
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
    ]);

    const res = await app.request("/elements?q=1", { method: "GET" });

    expect(res.status).toBe(200);
    expect(prisma.element.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { id: { in: getElementIdsMatchingKeyword("1") } },
          { symbol: { contains: "1", mode: "insensitive" } },
          { nameJa: { contains: "1" } },
          { nameEn: { contains: "1", mode: "insensitive" } },
        ],
      },
      orderBy: { id: "asc" },
    });
  });

  it("category と period で完全一致検索を行う", async () => {
    vi.mocked(prisma.element.findMany).mockResolvedValue([
      {
        id: 6,
        symbol: "C",
        nameJa: "炭素",
        nameEn: "Carbon",
        category: "非金属",
        period: 2,
        group: 14,
        atomicWeight: 12.011,
        etymology: null,
      },
    ]);

    const params = new URLSearchParams({
      category: "非金属",
      period: "2",
    });
    const res = await app.request(`/elements?${params.toString()}`, { method: "GET" });

    expect(res.status).toBe(200);
    expect(prisma.element.findMany).toHaveBeenCalledWith({
      where: {
        category: "非金属",
        period: 2,
      },
      orderBy: { id: "asc" },
    });
  });

  it("q/category/period を組み合わせて検索する", async () => {
    vi.mocked(prisma.element.findMany).mockResolvedValue([
      {
        id: 6,
        symbol: "C",
        nameJa: "炭素",
        nameEn: "Carbon",
        category: "非金属",
        period: 2,
        group: 14,
        atomicWeight: 12.011,
        etymology: null,
      },
    ]);

    const params = new URLSearchParams({
      q: " 炭 ",
      category: " 非金属 ",
      period: "2",
    });
    const res = await app.request(`/elements?${params.toString()}`, { method: "GET" });

    expect(res.status).toBe(200);
    expect(prisma.element.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { symbol: { contains: "炭", mode: "insensitive" } },
          { nameJa: { contains: "炭" } },
          { nameEn: { contains: "炭", mode: "insensitive" } },
        ],
        category: "非金属",
        period: 2,
      },
      orderBy: { id: "asc" },
    });
  });

  it("不正な period は400を返しDBを参照しない", async () => {
    const res = await app.request("/elements?period=8", { method: "GET" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "バリデーションエラー" });
    expect(body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "周期は1から7の整数で指定してください",
        }),
      ]),
    );
    expect(prisma.element.findMany).not.toHaveBeenCalled();
  });

  it("ログイン時は検索結果の元素IDだけを習得状態集計に渡す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveUser as never);
    vi.mocked(prisma.element.findMany).mockResolvedValue([
      {
        id: 6,
        symbol: "C",
        nameJa: "炭素",
        nameEn: "Carbon",
        category: "非金属",
        period: 2,
        group: 14,
        atomicWeight: 12.011,
        etymology: null,
      },
    ]);
    vi.mocked(prisma.gameSession.findMany).mockResolvedValue([] as never);

    const token = await createToken();
    const params = new URLSearchParams({
      q: "炭",
      category: "非金属",
      period: "2",
    });
    const res = await app.request(`/elements?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(prisma.gameSession.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      orderBy: [{ playedAt: "desc" }, { id: "desc" }],
      skip: 0,
      take: 50,
      select: {
        answers: {
          where: {
            elementId: { in: [6] },
          },
          select: {
            elementId: true,
            isCorrect: true,
          },
        },
      },
    });
  });

  it("不正なトークンの場合は401を返す", async () => {
    const res = await app.request("/elements", {
      method: "GET",
      headers: { Authorization: "Bearer invalid-token" },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "トークンが無効です" });
  });

  it("予期しないエラー時は500を返す", async () => {
    vi.mocked(prisma.element.findMany).mockRejectedValue(new Error("unexpected"));

    const res = await app.request("/elements", { method: "GET" });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "サーバーエラーが発生しました" });
  });
});
