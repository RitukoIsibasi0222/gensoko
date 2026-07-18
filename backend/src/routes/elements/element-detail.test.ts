import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppVariables } from "../../types/index.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    element: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
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
import { createElementsTestRouter } from "./test-helpers.js";

const app = new Hono<{ Variables: AppVariables }>();
app.route("/elements", createElementsTestRouter(prisma as never, "test-secret"));

const VALID_ELEMENT = {
  id: 1,
  symbol: "H",
  nameJa: "水素",
  nameEn: "Hydrogen",
  category: "非金属",
  period: 1,
  group: 1,
  atomicWeight: 1.008,
  etymology: "ラテン語 hydrogenium に由来",
};

describe("GET /elements/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("指定した元素を200で返す", async () => {
    vi.mocked(prisma.element.findUnique).mockResolvedValue(VALID_ELEMENT);

    const res = await app.request("/elements/1", { method: "GET" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ element: VALID_ELEMENT });
    expect(prisma.element.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("Authorization ヘッダーがあっても認証処理や masteryStatus 付与を行わない", async () => {
    vi.mocked(prisma.element.findUnique).mockResolvedValue(VALID_ELEMENT);

    const res = await app.request("/elements/1", {
      method: "GET",
      headers: { Authorization: "Bearer invalid-token" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ element: VALID_ELEMENT });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.gameSession.findMany).not.toHaveBeenCalled();
  });

  it("不正な id は400を返しDBを参照しない", async () => {
    const res = await app.request("/elements/abc", { method: "GET" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "バリデーションエラー" });
    expect(body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "元素IDは1から118の整数で指定してください",
        }),
      ]),
    );
    expect(prisma.element.findUnique).not.toHaveBeenCalled();
  });

  it("範囲外の id は400を返しDBを参照しない", async () => {
    const res = await app.request("/elements/119", { method: "GET" });

    expect(res.status).toBe(400);
    expect(prisma.element.findUnique).not.toHaveBeenCalled();
  });

  it("10進整数以外の数値表記は400を返しDBを参照しない", async () => {
    const res = await app.request("/elements/1e2", { method: "GET" });

    expect(res.status).toBe(400);
    expect(prisma.element.findUnique).not.toHaveBeenCalled();
  });

  it("指定した元素が存在しない場合は404を返す", async () => {
    vi.mocked(prisma.element.findUnique).mockResolvedValue(null);

    const res = await app.request("/elements/118", { method: "GET" });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "元素が見つかりません" });
    expect(prisma.element.findUnique).toHaveBeenCalledWith({ where: { id: 118 } });
  });

  it("予期しないエラー時は500を返す", async () => {
    vi.mocked(prisma.element.findUnique).mockRejectedValue(new Error("unexpected"));

    const res = await app.request("/elements/1", { method: "GET" });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "サーバーエラーが発生しました" });
  });
});
