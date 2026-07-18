import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authRouter } from "./index.js";

// Prisma モック
vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    userStats: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
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
import { STRONG_PASSWORD_73_BYTES } from "../../test/password-byte-boundary-fixtures.js";

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
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
  vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
    return callback({
      user: {
        findUnique: prisma.user.findUnique,
        update: prisma.user.update,
        updateMany: prisma.user.updateMany,
      },
      userStats: {
        findUnique: prisma.userStats.findUnique,
        upsert: prisma.userStats.upsert,
      },
      refreshToken: {
        create: prisma.refreshToken.create,
      },
      auditLog: {
        create: prisma.auditLog.create,
      },
    } as never);
  });
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
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

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

  it("既存互換性: 73バイトのパスワードを上限拒否せず完全な値で照合する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.userStats.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "taro@example.com",
        password: STRONG_PASSWORD_73_BYTES,
      }),
    });

    expect(res.status).toBe(200);
    expect(bcrypt.compare).toHaveBeenCalledWith(STRONG_PASSWORD_73_BYTES, ACTIVE_USER.passwordHash);
  });

  it("正常系: レスポンスに HttpOnly Cookie の Set-Cookie ヘッダーが含まれる", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.userStats.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(200);
    // login は deleteCookie(旧 Path) も呼ぶため Set-Cookie が複数になる場合がある
    // getSetCookie() で全件取得し、発行 Cookie（Max-Age=0 でない）を選んで検証する
    const setCookies = res.headers.getSetCookie();
    const issuedCookie = setCookies.find(
      (c) => c.startsWith("refreshToken=") && !c.includes("Max-Age=0"),
    );
    expect(issuedCookie).toBeTruthy();
    expect(issuedCookie).toContain("HttpOnly");
    // Path=/auth ベースであることを確認（/auth/logout でも Cookie が届く設計）
    expect(issuedCookie).toContain("Path=/auth;");
  });

  it("バリデーション: email が不正な場合は 400 を返す", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "Pass1234!" }),
    });

    expect(res.status).toBe(400);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("バリデーション: password が空の場合は 400 を返す", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "" }),
    });

    expect(res.status).toBe(400);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("バリデーション: email・password が未指定の場合は 400 を返す", async () => {
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("物理削除後: 旧資格情報は存在しないアカウントと同じ汎用401を返す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "notfound@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      error: "メールアドレスまたはパスワードが正しくありません",
    });
    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
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

  it("ブルートフォース: ロック期限切れの場合は failCount をリセットしてから検証する", async () => {
    const expiredLockedUser = {
      ...ACTIVE_USER,
      loginFailCount: 5,
      lockedUntil: new Date(Date.now() - 1000), // 期限切れ
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(expiredLockedUser as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "WrongPass1!" }),
    });

    // 1回目の update でロック解除リセット、2回目の update で failCount=1 になること
    expect(res.status).toBe(401);
    const updateCalls = vi.mocked(prisma.user.update).mock.calls;
    // リセット呼び出し: loginFailCount=0, lockedUntil=null
    expect(updateCalls[0][0].data).toEqual({ loginFailCount: 0, lockedUntil: null });
    // パスワード失敗後の呼び出し: loginFailCount=1（上限 5 で再ロックされない）
    expect(updateCalls[1][0].data).toEqual({ loginFailCount: 1 });
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

  it("パスワード正規化: 前後にスペースがある場合は trim してから検証する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    // trim 後のパスワードで比較が成功する
    vi.mocked(bcrypt.compare).mockImplementation((async (pwd: string) => {
      return pwd === "Pass1234!" ? true : false;
    }) as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.userStats.upsert).mockResolvedValue({} as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "taro@example.com",
        password: "  Pass1234!  ", // 前後にスペース
      }),
    });

    expect(res.status).toBe(200);
    // trim 後のパスワードで bcrypt.compare が呼ばれることを確認
    expect(bcrypt.compare).toHaveBeenCalledWith("Pass1234!", ACTIVE_USER.passwordHash);
  });

  it("パスワード正規化: 内部にスペースがある場合はクライアント側で弾かれるべき（サーバーでは 401）", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never); // パスワード不一致
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "taro@example.com",
        password: "Pass 1234!", // 内部にスペース（本来はクライアント側で弾く）
      }),
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("メールアドレスまたはパスワードが正しくありません");
    // loginFailCount が増加することを確認
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: ACTIVE_USER.id },
      data: { loginFailCount: 1 },
    });
  });

  it("監査: ログイン成功のDB更新と成功監査を同一transactionで実行する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.userStats.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        role: "USER",
        emailVerified: true,
        isActive: true,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: expect.any(Date) } }],
      },
      data: {
        loginFailCount: 0,
        lockedUntil: null,
        lastLoginAt: expect.any(Date),
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: "LOGIN",
        result: "SUCCESS",
        actorId: "user-1",
        actorRole: "USER",
        targetType: "USER",
        targetId: "user-1",
        failureReason: null,
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bcrypt.compare).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.$transaction).mock.invocationCallOrder[0],
    );
  });

  it("競合: パスワード検証後に停止された場合は成功処理と成功監査を確定しない", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

    const txUserFindUnique = vi.fn().mockResolvedValue({
      role: "USER",
      emailVerified: true,
      isActive: false,
      lockedUntil: null,
    });
    const txUserUpdate = vi.fn().mockResolvedValue({});
    const txRefreshTokenCreate = vi.fn().mockResolvedValue({});
    const txAuditLogCreate = vi.fn().mockResolvedValue({});

    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      return callback({
        user: {
          findUnique: txUserFindUnique,
          update: txUserUpdate,
        },
        userStats: {
          findUnique: vi.fn(),
          upsert: vi.fn(),
        },
        refreshToken: { create: txRefreshTokenCreate },
        auditLog: { create: txAuditLogCreate },
      } as never);
    });

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "アカウントが停止されています" });
    expect(txUserFindUnique).toHaveBeenCalledOnce();
    expect(txUserUpdate).not.toHaveBeenCalled();
    expect(txRefreshTokenCreate).not.toHaveBeenCalled();
    expect(txAuditLogCreate).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: "LOGIN",
        result: "FAILURE",
        actorId: null,
        actorRole: null,
        targetType: null,
        targetId: null,
        failureReason: "AUTHENTICATION_FAILED",
      },
    });
  });

  it("物理削除競合: パスワード検証後にUser rowが消えた場合は汎用401で成功副作用を確定しない", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(ACTIVE_USER as never)
      .mockResolvedValueOnce(null);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "メールアドレスまたはパスワードが正しくありません",
    });
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.userStats.upsert).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: "LOGIN",
        result: "FAILURE",
        actorId: null,
        actorRole: null,
        targetType: null,
        targetId: null,
        failureReason: "AUTHENTICATION_FAILED",
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("競合: transaction内の再確認後に状態が変わった場合は409で再試行を求める", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(ACTIVE_USER as never)
      .mockResolvedValueOnce({
        role: "USER",
        emailVerified: true,
        isActive: true,
        lockedUntil: null,
      } as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 0 } as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "アカウント情報が変更されました。再試行してください",
    });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(prisma.userStats.upsert).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "LOGIN",
        result: "FAILURE",
        actorId: null,
        targetId: null,
        failureReason: "AUTHENTICATION_FAILED",
      }),
    });
  });

  it("監査: 成功監査の保存失敗時は500を返しrefresh token Cookieを発行しない", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.userStats.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.userStats.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error("audit insert failed"));

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "サーバーエラーが発生しました" });
    const issuedCookie = res.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("refreshToken=") && !cookie.includes("Max-Age=0"));
    expect(issuedCookie).toBeUndefined();
  });

  it("監査: ユーザー不存在の失敗は操作者・対象を特定せず記録する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "notfound@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(401);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: "LOGIN",
        result: "FAILURE",
        actorId: null,
        actorRole: null,
        targetType: null,
        targetId: null,
        failureReason: "AUTHENTICATION_FAILED",
      },
    });
  });

  it("監査: パスワード不一致の監査保存失敗でも元の401を維持する", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(ACTIVE_USER as never);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error("audit insert failed"));

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "WrongPass1!" }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "メールアドレスまたはパスワードが正しくありません",
    });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls.flat()).not.toContainEqual(expect.any(Error));

    consoleErrorSpy.mockRestore();
  });

  it.each([
    {
      name: "停止中",
      user: { ...ACTIVE_USER, isActive: false },
      status: 403,
    },
    {
      name: "メール未確認",
      user: { ...ACTIVE_USER, emailVerified: false },
      status: 403,
    },
    {
      name: "ロック中",
      user: { ...ACTIVE_USER, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) },
      status: 401,
    },
  ])("監査: $nameの失敗を個人情報なしで記録する", async ({ user, status }) => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);

    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taro@example.com", password: "Pass1234!" }),
    });

    expect(res.status).toBe(status);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: "LOGIN",
        result: "FAILURE",
        actorId: null,
        actorRole: null,
        targetType: null,
        targetId: null,
        failureReason: "AUTHENTICATION_FAILED",
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
