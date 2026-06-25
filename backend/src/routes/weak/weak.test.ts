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
  deleteWeakElement: vi.fn(),
  WeakElementNotFoundError: class WeakElementNotFoundError extends Error {
    constructor() {
      super("苦手元素が見つかりません");
      this.name = "WeakElementNotFoundError";
    }
  },
}));

import { prisma } from "../../lib/prisma.js";
import {
  deleteWeakElement,
  getWeakElements,
  WeakElementNotFoundError,
} from "../../services/weak.service.js";
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

describe("DELETE /weak/:elementId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveUser as never);
    vi.mocked(deleteWeakElement).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("未認証なら401を返す", async () => {
    const res = await app.request("/weak/26", { method: "DELETE" });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "認証が必要です" });
    expect(deleteWeakElement).not.toHaveBeenCalled();
  });

  it("elementId が不正なら400を返す", async () => {
    const token = await createToken();
    const res = await app.request("/weak/abc", {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("バリデーションエラー");
    expect(body.details[0].message).toBe("元素IDは1から118の整数で指定してください");
    expect(deleteWeakElement).not.toHaveBeenCalled();
  });

  it("認証済みユーザーの苦手元素を削除して200を返す", async () => {
    const token = await createToken();
    const res = await app.request("/weak/26", {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "苦手リストから削除しました" });
    expect(deleteWeakElement).toHaveBeenCalledWith({ userId: "user-1", elementId: 26 });
  });

  it("削除対象がない場合は404を返す", async () => {
    vi.mocked(deleteWeakElement).mockRejectedValue(new WeakElementNotFoundError());
    const token = await createToken();
    const res = await app.request("/weak/26", {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "苦手元素が見つかりません" });
  });

  it("予期しないエラーでは500を返す", async () => {
    vi.mocked(deleteWeakElement).mockRejectedValue(new Error("db error"));
    const token = await createToken();
    const res = await app.request("/weak/26", {
      method: "DELETE",
      headers: { Authorization: "Bearer " + token },
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "サーバーエラーが発生しました" });
  });
});
