import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authRouter } from "./auth.js";

// Prisma モック
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    emailVerification: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// mail モック
vi.mock("../lib/mail.js", () => ({
  mailer: {
    sendMail: vi.fn(),
  },
}));

// crypto モック（テスト内で固定値を使う）
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    randomBytes: vi.fn(() => Buffer.from("a".repeat(32))),
    createHash: actual.createHash,
  };
});

import { mailer } from "../lib/mail.js";
import { prisma } from "../lib/prisma.js";

const app = new Hono();
app.route("/auth", authRouter);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /auth/register", () => {
  it("正常系: 正しいデータで 201 と確認メッセージを返す", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "user-1" }),
        },
        emailVerification: { create: vi.fn().mockResolvedValue({}) },
      } as never);
    });
    vi.mocked(mailer.sendMail).mockResolvedValue(undefined as never);

    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "taro123",
        email: "taro@example.com",
        password: "Pass1234!",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ message: "確認メールを送信しました" });
  });

  it("バリデーション: email が不正な場合は 400 を返す", async () => {
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "taro123",
        email: "not-an-email",
        password: "Pass1234!",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("バリデーション: パスワードが強度不足の場合は 400 を返す", async () => {
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "taro123",
        email: "taro@example.com",
        password: "weak",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("バリデーション: username が不正な形式の場合は 400 を返す", async () => {
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "ab",
        email: "taro@example.com",
        password: "Pass1234!",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("重複: メールアドレスが既に使用中の場合は 409 を返す", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: {
          findFirst: vi.fn().mockResolvedValue({
            id: "existing-user",
            email: "taro@example.com",
            username: "other",
          }),
          create: vi.fn(),
        },
        emailVerification: { create: vi.fn() },
      } as never);
    });

    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "taro123",
        email: "taro@example.com",
        password: "Pass1234!",
      }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("重複: ユーザー名が既に使用中の場合は 409 を返す", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: {
          findFirst: vi.fn().mockResolvedValue({
            id: "existing-user",
            email: "other@example.com",
            username: "taro123",
          }),
          create: vi.fn(),
        },
        emailVerification: { create: vi.fn() },
      } as never);
    });

    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "taro123",
        email: "taro@example.com",
        password: "Pass1234!",
      }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("メール送信失敗: sendMail が throw した場合は 500 を返す", async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "user-1" }),
        },
        emailVerification: { create: vi.fn().mockResolvedValue({}) },
      } as never);
    });
    vi.mocked(mailer.sendMail).mockRejectedValue(new Error("SMTP error"));

    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "taro123",
        email: "taro@example.com",
        password: "Pass1234!",
      }),
    });

    expect(res.status).toBe(500);
  });
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
