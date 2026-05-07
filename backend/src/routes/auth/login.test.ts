import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authRouter } from "./index.js";

// Prisma モック
vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    userStats: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

// bcryptjs モック
vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

// hono/jwt モック（sign の戻り値を固定）
vi.mock("hono/jwt", () => ({
  sign: vi.fn().mockResolvedValue("mock-access-token"),
  verify: vi.fn(),
}));

import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";

const app = new Hono();
app.route("/auth", authRouter);

const ACTIVE_USER = {
  id: "user-1",
  username: "taro123",
  role: "USER" as const,
  passwordHash: "$2b$12$hashedpassword",
  emailVerified: true,
  isActive: true,
  loginFailCount: 0,
  lockedUntil: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JWT_SECRET", "test-secret-32chars-long-enough!!");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /auth/login", () => {
  it("正常系: 正しい認証情報で 200 と accessToken・user を返す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.userStats.upsert).mockResolvedValue({} as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accessToken).toBe("mock-access-token");
    expect(body.user).toEqual({ id: "user-1", username: "taro123", role: "USER" });
  });

  it("バリデーション: email が不正な場合は 400 を返す", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "Pass1234!" }),
    });

    expect(res.status).toBe(400);
  });

  it("バリデーション: password が空の場合は 400 を返す", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "" }),
    });

    expect(res.status).toBe(400);
  });

  it("バリデーション: email・password が未指定の場合は 400 を返す", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it("異常系: 存在しないメールアドレスの場合は 401 を返す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "notfound@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("異常系: パスワードが誤りの場合は 401 を返す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "WrongPass1!" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("ブルートフォース: 5回目の失敗で loginFailCount=5 かつ lockedUntil が設定される", async () => {
    const userWith4Fails = { ...ACTIVE_USER, loginFailCount: 4 };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(userWith4Fails as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "WrongPass1!" }),
    });

    expect(res.status).toBe(401);
    expect(vi.mocked(prisma.user.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          loginFailCount: 5,
          lockedUntil: expect.any(Date),
        }),
      }),
    );
  });

  it("ブルートフォース: ロック中のアカウントはパスワード検証なしに 401 を返す", async () => {
    const lockedUser = {
      ...ACTIVE_USER,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(lockedUser as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
    // パスワード検証が呼ばれていないことを確認
    expect(vi.mocked(bcrypt.compare)).not.toHaveBeenCalled();
  });

  it("異常系: メール未確認の場合は 403 を返す", async () => {
    const unverifiedUser = { ...ACTIVE_USER, emailVerified: false };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(unverifiedUser as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("異常系: アカウント停止中の場合は 403 を返す", async () => {
    const inactiveUser = { ...ACTIVE_USER, isActive: false };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(inactiveUser as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("streak: 昨日ログイン済みの場合は currentStreak が +1 になる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue({
      currentStreak: 3,
      lastActiveDate: yesterday,
    } as never);
    vi.mocked(prisma.userStats.upsert).mockResolvedValue({} as never);

    await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(vi.mocked(prisma.userStats.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ currentStreak: 4 }),
      }),
    );
  });

  it("streak: 2日以上空いた場合は currentStreak が 1 にリセットされる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const threeDaysAgo = new Date();
    threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue({
      currentStreak: 5,
      lastActiveDate: threeDaysAgo,
    } as never);
    vi.mocked(prisma.userStats.upsert).mockResolvedValue({} as never);

    await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(vi.mocked(prisma.userStats.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ currentStreak: 1 }),
      }),
    );
  });

  it("streak: 今日すでにログイン済みの場合は upsert を呼ばない", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const today = new Date();
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue({
      currentStreak: 2,
      lastActiveDate: today,
    } as never);

    await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(vi.mocked(prisma.userStats.upsert)).not.toHaveBeenCalled();
  });
});
