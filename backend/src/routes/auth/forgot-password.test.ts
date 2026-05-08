import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { authRouter } from "./index.js";

// rateLimit ミドルウェアをテスト環境でスルーにする
vi.mock("../../middleware/rateLimit/index.js", () => ({
  rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

// Prisma のモック
vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    passwordResetToken: {
      upsert: vi.fn(),
    },
  },
}));

// mailer のモック
vi.mock("../../lib/mail.js", () => ({
  mailer: {
    sendMail: vi.fn(),
  },
}));

import { prisma } from "../../lib/prisma.js";
import { mailer } from "../../lib/mail.js";

const app = new Hono().route("/auth", authRouter);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /auth/forgot-password", () => {
  it("正常系: 登録済みメールアドレスの場合、メールを送信して200を返す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      email: "taro@example.com",
    } as never);
    vi.mocked(prisma.passwordResetToken.upsert).mockResolvedValue({} as never);
    vi.mocked(mailer.sendMail).mockResolvedValue({} as never);

    vi.stubEnv("FRONTEND_URL", "http://localhost:5174");

    const res = await app.request("/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "パスワードリセットメールを送信しました" });
    expect(mailer.sendMail).toHaveBeenCalledOnce();
  });

  it("列挙攻撃対策: 存在しないメールでも200を返す（メールは送信しない）", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await app.request("/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "notexist@example.com" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "パスワードリセットメールを送信しました" });
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });

  it("バリデーション: メール形式が不正な場合は400を返す", async () => {
    const res = await app.request("/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invalid-email" }),
    });

    expect(res.status).toBe(400);
  });
});
