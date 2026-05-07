import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authRouter } from "./index.js";

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

  it("正常系: Cookieがない場合も 204 を返す（冪等）", async () => {
    const res = await app.request("/auth/logout", {
      method: "POST",
    });

    expect(res.status).toBe(204);
    // Cookie がないので DB アクセスは不要
    expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
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
    // 壊れた Cookie は削除ヘッダーを返す
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("refreshToken=");
    expect(setCookie).toMatch(/Max-Age=0|Expires=/);
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
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain("refreshToken=");
    expect(setCookie).toMatch(/Max-Age=0|Expires=/);
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
    const setCookie = res.headers.get("Set-Cookie");
    // Path=/auth であることで /auth/logout にも Cookie が送られる
    expect(setCookie).toContain("Path=/auth");
  });
});
