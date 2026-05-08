import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authRouter } from "./index.js";

// rateLimit ミドルウェアをテスト環境でスルーにする
vi.mock("../../middleware/rateLimit/index.js", () => ({
  rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

// Prisma モック
vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    refreshToken: {
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../lib/prisma.js";

const app = new Hono();
app.route("/auth", authRouter);

const VALID_RAW_TOKEN = "a".repeat(64); // randomBytes(32).toString("hex") と同形式

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /auth/logout", () => {
  it("正常系: 有効なリフレッシュトークンで 204 を返し、DBからトークンを削除する", async () => {
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as never);

    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${VALID_RAW_TOKEN}`,
      },
    });

    expect(res.status).toBe(204);
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledOnce();
  });

  it("正常系: DBに存在しないトークンでも 204 を返す（冪等）", async () => {
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 0 } as never);

    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${VALID_RAW_TOKEN}`,
      },
    });

    expect(res.status).toBe(204);
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledOnce();
  });

  it("正常系: Cookieがない場合も 204 を返し、両 Path の削除ヘッダーを付ける（旧 Path 残存 Cookie も確実にクリア）", async () => {
    const res = await app.request("/auth/logout", {
      method: "POST",
    });

    expect(res.status).toBe(204);
    // Cookie がないので DB アクセスは不要
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    // Cookie がなくても削除ヘッダーは返す（旧 Path 残存 Cookie の確実なクリアのため）
    const setCookies = res.headers.getSetCookie();
    expect(
      setCookies.some((c) => /Path=\/auth(?!\/)/.test(c) && /Max-Age=0|Expires=/.test(c)),
    ).toBe(true);
    expect(
      setCookies.some((c) => c.includes("Path=/auth/refresh") && /Max-Age=0|Expires=/.test(c)),
    ).toBe(true);
  });

  it("正常系: 形式不正のトークンでも 204 を返す（冪等）", async () => {
    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=invalid-token`,
      },
    });

    expect(res.status).toBe(204);
    // 形式不正なので DB アクセスは不要
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
  });

  it("正常系: 空文字の Cookie でも 204 を返し、Cookie 削除ヘッダーを付ける", async () => {
    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=`,
      },
    });

    expect(res.status).toBe(204);
    // 空文字は形式不正なので DB アクセスは不要
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    // 壊れた Cookie は削除ヘッダーを返す（両 Path）
    const setCookies = res.headers.getSetCookie();
    expect(
      setCookies.some((c) => /Path=\/auth(?!\/)/.test(c) && /Max-Age=0|Expires=/.test(c)),
    ).toBe(true);
    expect(
      setCookies.some((c) => c.includes("Path=/auth/refresh") && /Max-Age=0|Expires=/.test(c)),
    ).toBe(true);
  });

  it("正常系: レスポンスに refreshToken Cookie の削除ヘッダーが含まれる", async () => {
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as never);

    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${VALID_RAW_TOKEN}`,
      },
    });

    expect(res.status).toBe(204);
    // 両 Path（/auth と /auth/refresh）の削除 Cookie が含まれることを個別に確認
    const setCookies = res.headers.getSetCookie();
    expect(
      setCookies.some((c) => /Path=\/auth(?!\/)/.test(c) && /Max-Age=0|Expires=/.test(c)),
    ).toBe(true);
    expect(
      setCookies.some((c) => c.includes("Path=/auth/refresh") && /Max-Age=0|Expires=/.test(c)),
    ).toBe(true);
  });

  it("設計: Set-Cookie の Path が /auth ベースであり logout でも Cookie が届く設計になっている", async () => {
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as never);

    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${VALID_RAW_TOKEN}`,
      },
    });

    expect(res.status).toBe(204);
    const setCookies = res.headers.getSetCookie();
    // /Path=\/auth(?!\/)/ により Path=/auth/refresh の部分一致では通らないことを保証
    expect(setCookies.some((c) => /Path=\/auth(?!\/)/.test(c))).toBe(true);
  });
});
