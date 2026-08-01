import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthTestRouter } from "./test-helpers.js";

// Prisma モック
vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    emailVerification: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../lib/prisma.js";
const authRouter = createAuthTestRouter(prisma as never);

const app = new Hono();
app.route("/auth", authRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /auth/verify-email", () => {
  const VALID_TOKEN = "a".repeat(64);

  it("正常系: 正しいトークンで 200 とメッセージを返す", async () => {
    vi.mocked(prisma.emailVerification.findUnique).mockResolvedValue({
      id: "ev-1",
      userId: "user-1",
      tokenHash: "hashed",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: false,
    } as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        emailVerification: { delete: vi.fn().mockResolvedValue({}) },
        user: { update: vi.fn().mockResolvedValue({}) },
      } as never);
    });

    const res = await app.request("/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: VALID_TOKEN }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "メールアドレスを確認しました" });
  });

  it("バリデーション: token なしの場合は 400 を返す", async () => {
    const res = await app.request("/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("バリデーション: 64文字でも非hex文字列の場合は 400 を返す", async () => {
    // 'x' は hex 文字ではないため /^[0-9a-f]{64}$/ に不一致
    const nonHexToken = "x".repeat(64);
    const res = await app.request("/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: nonHexToken }),
    });

    expect(res.status).toBe(400);
  });

  it("異常系: 存在しないトークンの場合は 404 を返す", async () => {
    vi.mocked(prisma.emailVerification.findUnique).mockResolvedValue(null);

    const res = await app.request("/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: VALID_TOKEN }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("異常系: 有効期限切れのトークンの場合は 400 を返す", async () => {
    vi.mocked(prisma.emailVerification.findUnique).mockResolvedValue({
      id: "ev-1",
      userId: "user-1",
      tokenHash: "hashed",
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    } as never);
    vi.mocked(prisma.emailVerification.delete).mockResolvedValue({} as never);

    const res = await app.request("/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: VALID_TOKEN }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("異常系: 既に認証済みのユーザーの場合は 400 を返す", async () => {
    vi.mocked(prisma.emailVerification.findUnique).mockResolvedValue({
      id: "ev-1",
      userId: "user-1",
      tokenHash: "hashed",
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      emailVerified: true,
    } as never);

    const res = await app.request("/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: VALID_TOKEN }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
