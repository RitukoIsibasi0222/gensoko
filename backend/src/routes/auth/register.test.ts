import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthTestRouter } from "./test-helpers.js";

// Prisma モック
vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    emailVerification: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// mail モック
vi.mock("../../lib/mail.js", () => ({
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

import { mailer } from "../../lib/mail.js";
import { PASSWORD_TOO_LONG_MESSAGE } from "../../lib/password.js";
import { prisma } from "../../lib/prisma.js";
const authRouter = createAuthTestRouter(prisma as never);
import {
  STRONG_PASSWORD_72_BYTES,
  STRONG_PASSWORD_73_BYTES,
} from "../../test/password-byte-boundary-fixtures.js";

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
        password: STRONG_PASSWORD_72_BYTES,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ message: "確認メールを送信しました" });
  });

  it("物理削除後: 同じメールアドレス・ユーザー名で新しいUser IDを発行して再登録できる", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const createUser = vi.fn().mockResolvedValue({ id: "new-user-id" });
    const createEmailVerification = vi.fn().mockResolvedValue({});

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: {
          findFirst,
          create: createUser,
        },
        emailVerification: { create: createEmailVerification },
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
    expect(findFirst).toHaveBeenCalledOnce();
    expect(createUser).toHaveBeenCalledWith({
      data: {
        username: "taro123",
        email: "taro@example.com",
        passwordHash: expect.any(String),
      },
      select: { id: true },
    });
    expect(createEmailVerification).toHaveBeenCalledWith({
      data: {
        userId: "new-user-id",
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      },
    });
    expect(mailer.sendMail).toHaveBeenCalledOnce();
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

  it("バリデーション: 73バイトのパスワードは400を返し副作用を開始しない", async () => {
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "taro123",
        email: "taro@example.com",
        password: STRONG_PASSWORD_73_BYTES,
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "バリデーションエラー",
      details: [
        expect.objectContaining({
          message: PASSWORD_TOO_LONG_MESSAGE,
          path: ["password"],
        }),
      ],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mailer.sendMail).not.toHaveBeenCalled();
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

  it("未認証の同一メールアドレス・同一ユーザー名なら再登録できる", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "existing-user",
      email: "taro@example.com",
      username: "taro123",
      emailVerified: false,
    });
    const update = vi.fn().mockResolvedValue({ id: "existing-user" });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn().mockResolvedValue({});

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      return fn({
        user: {
          findFirst,
          create: vi.fn(),
          update,
        },
        emailVerification: {
          create,
          deleteMany,
        },
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
    expect(update).toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "existing-user" } });
    expect(create).toHaveBeenCalled();
  });

  it("メール送信失敗: sendMail が throw した場合は user を削除して 500 を返す", async () => {
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
    vi.mocked(prisma.user.delete).mockResolvedValue({} as never);

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
    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { id: true },
    });
  });

  it("バリデーション: パスワードにスペースを含む場合は 400 を返す", async () => {
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "taro123",
        email: "taro@example.com",
        password: "Pass 1234!", // スペースを含む
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("バリデーションエラー");
    expect(json.details).toBeDefined();
    // Zod の details にスペース禁止エラーが含まれることを確認
    expect(JSON.stringify(json.details)).toContain("スペース");
  });

  it("バリデーション: パスワードの前後にスペースがある場合は Zod バリデーションで 400 を返す", async () => {
    // Zod のバリデーションはサービス層より前に実行されるため、
    // 前後のスペースもスペース禁止ルールに引っかかる
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "taro123",
        email: "taro@example.com",
        password: "  Pass1234!  ", // 前後にスペース
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("バリデーションエラー");
    // details にスペース禁止エラーが含まれることを確認
    expect(json.details).toBeDefined();
    expect(JSON.stringify(json.details)).toContain("スペース");
  });
});
