import { Hono } from "hono";
import { sign } from "hono/jwt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppVariables } from "../../types/index.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../services/weak.service.js", () => ({
  getWeakElements: vi.fn(),
}));

import { prisma } from "../../lib/prisma.js";
import { getWeakElements } from "../../services/weak.service.js";
import { weakRouter } from "./index.js";

const app = new Hono<{ Variables: AppVariables }>();
app.route("/weak", weakRouter);

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

const mockWeakElements = [
  {
    elementId: 26,
    symbol: "Fe",
    nameJa: "鉄",
    missCount: 3,
    addedAt: new Date("2026-05-01T00:00:00.000Z"),
  },
];

describe("GET /weak", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveUser as never);
    vi.mocked(getWeakElements).mockResolvedValue(mockWeakElements);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("未認証なら401を返す", async () => {
    const res = await app.request("/weak", { method: "GET" });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "認証が必要です" });
    expect(getWeakElements).not.toHaveBeenCalled();
  });

  it("認証済みユーザーの苦手リストを200で返す", async () => {
    const token = await createToken();
    const res = await app.request("/weak", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      weakElements: [
        {
          elementId: 26,
          symbol: "Fe",
          nameJa: "鉄",
          missCount: 3,
          addedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
    });
    expect(getWeakElements).toHaveBeenCalledWith("user-1");
  });

  it("苦手元素がない場合は空配列を200で返す", async () => {
    vi.mocked(getWeakElements).mockResolvedValue([]);
    const token = await createToken();
    const res = await app.request("/weak", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ weakElements: [] });
  });

  it("予期しないエラーでは500を返す", async () => {
    vi.mocked(getWeakElements).mockRejectedValue(new Error("db error"));
    const token = await createToken();
    const res = await app.request("/weak", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "サーバーエラーが発生しました" });
  });
});
