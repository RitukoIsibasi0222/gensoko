import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { authRouter } from "./index.js";

// Prisma のモック
vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    passwordResetToken: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    refreshToken: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// bcryptjs モック（hash は遅い処理なのでテストを高速化）
vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2b$12$mockedhashedpassword"),
    compare: vi.fn(),
  },
}));

import { prisma } from "../../lib/prisma.js";

const app = new Hono().route("/auth", authRouter);

const VALID_TOKEN = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /auth/reset-password", () => {
  it("正常系: 有効なトークンで200を返し、パスワード更新と全RTの削除を行う", async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValue({
      id: "prt-1",
      userId: "user-1",
      tokenHash: "hashed",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      createdAt: new Date(),
    });

    const txUserUpdate = vi.fn().mockResolvedValue({});
    const txRefreshTokenDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const txPasswordResetTokenDeleteMany = vi.fn().mockResolvedValue({ count: 1 });

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: { update: txUserUpdate },
        refreshToken: { deleteMany: txRefreshTokenDeleteMany },
        passwordResetToken: { deleteMany: txPasswordResetTokenDeleteMany },
      } as never);
    });

    const res = await app.request("/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: VALID_TOKEN, password: "NewPass1!" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "パスワードをリセットしました" });
    expect(txUserUpdate).toHaveBeenCalledOnce();
    expect(txRefreshTokenDeleteMany).toHaveBeenCalledOnce();
    expect(txPasswordResetTokenDeleteMany).toHaveBeenCalledOnce();
  });

  it("無効なトークン: DBに存在しない場合は404を返す", async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValue(null);

    const res = await app.request("/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: VALID_TOKEN, password: "NewPass1!" }),
    });

    expect(res.status).toBe(404);
  });

  it("期限切れトークン: 400を返しトークンを削除する", async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValue({
      id: "prt-1",
      userId: "user-1",
      tokenHash: "hashed",
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    });
    vi.mocked(prisma.passwordResetToken.deleteMany).mockResolvedValue({ count: 1 });

    const res = await app.request("/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: VALID_TOKEN, password: "NewPass1!" }),
    });

    expect(res.status).toBe(400);
    expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledOnce();
  });

  it("バリデーション: tokenが64文字未満の場合は400を返す", async () => {
    const res = await app.request("/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "short", password: "NewPass1!" }),
    });

    expect(res.status).toBe(400);
  });

  it("バリデーション: パスワードが強度不足の場合は400を返す", async () => {
    const res = await app.request("/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: VALID_TOKEN, password: "weakpass" }),
    });

    expect(res.status).toBe(400);
  });

  it("二重使用: $transaction内でcount=0の場合は404を返す", async () => {
    vi.mocked(prisma.passwordResetToken.findUnique).mockResolvedValue({
      id: "prt-1",
      userId: "user-1",
      tokenHash: "hashed",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      createdAt: new Date(),
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: { update: vi.fn() },
        refreshToken: { deleteMany: vi.fn() },
        // count=0 → 並行リクエストによりトークンが既に削除済み
        passwordResetToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      } as never);
    });

    const res = await app.request("/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: VALID_TOKEN, password: "NewPass1!" }),
    });

    expect(res.status).toBe(404);
  });
});
