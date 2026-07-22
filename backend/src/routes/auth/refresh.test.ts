import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthTestRouter } from "./test-helpers.js";

// Prisma モック
vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// hono/jwt モック
vi.mock("hono/jwt", () => ({
  sign: vi.fn().mockResolvedValue("mock-access-token"),
  verify: vi.fn(),
}));

import { sign } from "hono/jwt";
import { prisma } from "../../lib/prisma.js";
const authRouter = createAuthTestRouter(prisma as never);
const productionAuthRouter = createAuthTestRouter(prisma as never, { isProduction: true });

const app = new Hono();
app.route("/auth", authRouter);
const productionApp = new Hono();
productionApp.route("/api/v1/auth", productionAuthRouter);

const ACTIVE_USER = {
  id: "user-1",
  username: "taro123",
  role: "USER" as const,
  isActive: true,
  emailVerified: true,
  lockedUntil: null,
};

const VALID_RAW_TOKEN = "a".repeat(64); // randomBytes(32).toString("hex") と同形式
const UNKNOWN_RAW_TOKEN = "b".repeat(64);
const EXPIRED_RAW_TOKEN = "c".repeat(64);

const VALID_TOKEN_RECORD = {
  id: "rt-1",
  tokenHash: "a".repeat(64), // sha256 結果は64文字の16進数
  userId: "user-1",
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7日後
  createdAt: new Date(),
  user: ACTIVE_USER,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JWT_SECRET", "test-secret-32chars-long-enough!!");
  // $transaction はコールバックを prisma 自身で実行する
  vi.mocked(prisma.$transaction).mockImplementation(
    async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /auth/refresh", () => {
  it("正常系: 有効なリフレッシュトークンで 200 と新 accessToken を返す", async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(VALID_TOKEN_RECORD as never);
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${VALID_RAW_TOKEN}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      accessToken: "mock-access-token",
      user: { id: "user-1", username: "taro123", role: "USER" },
    });
    expect(vi.mocked(sign)).toHaveBeenCalledOnce();
  });

  it("productionではhost-only Cookieの全属性を固定しDomainを付けない", async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(VALID_TOKEN_RECORD as never);
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    const res = await productionApp.request("/api/v1/auth/refresh", {
      method: "POST",
      headers: { Cookie: `refreshToken=${VALID_RAW_TOKEN}` },
    });

    const issuedCookie = res.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("refreshToken=") && !cookie.includes("Max-Age=0"));
    expect(issuedCookie).toContain("HttpOnly");
    expect(issuedCookie).toContain("Secure");
    expect(issuedCookie).toContain("SameSite=Strict");
    expect(issuedCookie).toContain("Path=/api/v1/auth;");
    expect(issuedCookie).toContain("Max-Age=604800");
    expect(issuedCookie).not.toContain("Domain=");
  });

  it("正常系: レスポンスに新しいリフレッシュトークンの Set-Cookie が含まれる", async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(VALID_TOKEN_RECORD as never);
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${VALID_RAW_TOKEN}`,
      },
    });

    const setCookies = res.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThanOrEqual(1);
    // 新しいトークンの Set-Cookie が含まれる
    const newTokenCookie = setCookies.find(
      (c) => c.startsWith("refreshToken=") && !c.includes("Max-Age=0"),
    );
    expect(newTokenCookie).toBeTruthy();
    expect(newTokenCookie).toContain("HttpOnly");
    // Path=/auth ベースであることを確認（/auth/logout でも Cookie が届く設計）
    expect(newTokenCookie).toContain("Path=/auth;");
  });

  it("正常系: 古いリフレッシュトークンが削除されて新しいものが作成される（ローテーション）", async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(VALID_TOKEN_RECORD as never);
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    await app.request("/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${VALID_RAW_TOKEN}`,
      },
    });

    // トランザクション内で deleteMany + create が呼ばれることを確認
    expect(vi.mocked(prisma.$transaction)).toHaveBeenCalledOnce();
    expect(vi.mocked(prisma.refreshToken.deleteMany)).toHaveBeenCalledOnce();
    expect(vi.mocked(prisma.refreshToken.create)).toHaveBeenCalledOnce();
  });

  it("異常系: Cookie のトークンが 64 文字 hex でない場合は 401 を返す", async () => {
    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: "refreshToken=invalid-short-token",
      },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
    // DB への問い合わせなし
    expect(vi.mocked(prisma.refreshToken.findUnique)).not.toHaveBeenCalled();
  });

  it("異常系: Cookie がない場合は 401 を返す", async () => {
    const res = await app.request("/auth/refresh", {
      method: "POST",
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("物理削除後: cascadeでトークンが消えている場合は401を返し両PathのCookieを削除する", async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(null);

    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${UNKNOWN_RAW_TOKEN}`,
      },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "無効なリフレッシュトークンです" });
    const setCookies = res.headers.getSetCookie();
    expect(
      setCookies.some((cookie) => /Path=\/auth(?!\/)/.test(cookie) && cookie.includes("Max-Age=0")),
    ).toBe(true);
    expect(
      setCookies.some(
        (cookie) => cookie.includes("Path=/auth/refresh") && cookie.includes("Max-Age=0"),
      ),
    ).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it("異常系: トークンが期限切れの場合は 401 を返しトークンを削除・Cookie をクリアする", async () => {
    const expiredRecord = {
      ...VALID_TOKEN_RECORD,
      expiresAt: new Date(Date.now() - 1000), // 期限切れ
    };
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(expiredRecord as never);
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as never);

    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${EXPIRED_RAW_TOKEN}`,
      },
    });

    expect(res.status).toBe(401);
    expect(vi.mocked(prisma.refreshToken.deleteMany)).toHaveBeenCalledOnce();
    const setCookieHeader = res.headers.get("Set-Cookie");
    expect(setCookieHeader).toContain("Max-Age=0");
  });

  it("競合loser: deleteMany count=0 は409を返しwinnerの新Cookieを削除しない", async () => {
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(VALID_TOKEN_RECORD as never);
    // 並行リクエストで既に削除済みのケース
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 0 } as never);

    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${VALID_RAW_TOKEN}`,
      },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "リフレッシュトークンは既に更新されています",
    });
    expect(res.headers.getSetCookie()).toEqual([]);
    // 新トークンが発行されていないことを確認
    expect(vi.mocked(prisma.refreshToken.create)).not.toHaveBeenCalled();
  });

  it("異常系: ユーザーが停止されている場合は 403 を返す", async () => {
    const suspendedRecord = {
      ...VALID_TOKEN_RECORD,
      user: { ...ACTIVE_USER, isActive: false },
    };
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(suspendedRecord as never);
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValue({ count: 1 } as never);

    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: `refreshToken=${VALID_RAW_TOKEN}`,
      },
    });

    expect(res.status).toBe(403);
  });

  it("logoutでrevokeした旧refresh tokenは再利用を401で拒否する", async () => {
    vi.mocked(prisma.refreshToken.deleteMany).mockResolvedValueOnce({ count: 1 } as never);
    const logoutResponse = await app.request("/auth/logout", {
      method: "POST",
      headers: { Cookie: `refreshToken=${VALID_RAW_TOKEN}` },
    });
    vi.mocked(prisma.refreshToken.findUnique).mockResolvedValueOnce(null);

    const refreshResponse = await app.request("/auth/refresh", {
      method: "POST",
      headers: { Cookie: `refreshToken=${VALID_RAW_TOKEN}` },
    });

    expect(logoutResponse.status).toBe(204);
    expect(refreshResponse.status).toBe(401);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });
});
