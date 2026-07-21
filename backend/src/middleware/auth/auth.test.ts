/**
 * middleware/auth.test.ts
 *
 * TDD: このファイルを先に書いて「何をテストするか」を明確にする
 * 実装（auth.ts）がないと最初は全テスト失敗する → それが正常（Red フェーズ）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { sign } from "hono/jwt";
import type { AppVariables } from "../../types/index.js";

// -----------------------------------------------------------------
// Prisma をモック化
// → 実際の DB に接続せず、テストの中で戻り値を自由に設定できる
// -----------------------------------------------------------------
vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// モック化した後にインポート（順序が重要）
import { createAuthMiddlewares } from "./index.js";
import { prisma } from "../../lib/prisma.js";

// -----------------------------------------------------------------
// テスト用の定数・ヘルパー
// -----------------------------------------------------------------

/** テスト専用の JWT_SECRET（本番とは別） */
const TEST_SECRET = "test-secret-key-for-vitest";
const { authMiddleware, optionalAuthMiddleware } = createAuthMiddlewares({
  prisma: prisma as never,
  jwtSecret: TEST_SECRET,
});

/** テスト用トークンを生成するヘルパー */
const createToken = async (overrides: Record<string, unknown> = {}) => {
  return sign(
    {
      sub: "user-1",
      role: "USER",
      // 1時間後に期限切れ
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    },
    TEST_SECRET,
    "HS256",
  );
};

/** DB に存在する正常なユーザーのモックデータ */
const mockActiveUser = {
  id: "user-1",
  role: "USER" as const,
  isActive: true,
  emailVerified: true,
  lockedUntil: null,
};

/** authMiddleware を使うテスト用 Hono アプリを作成 */
const createApp = () => {
  const app = new Hono<{ Variables: AppVariables }>();

  // 認証必須のエンドポイント
  app.get("/protected", authMiddleware, (c) => {
    const user = c.get("user");
    return c.json({ userId: user!.id, role: user!.role });
  });

  return app;
};

/** optionalAuthMiddleware を使うテスト用 Hono アプリ */
const createOptionalApp = () => {
  const app = new Hono<{ Variables: AppVariables }>();

  app.get("/public", optionalAuthMiddleware, (c) => {
    const user = c.get("user");
    // user があればログイン済み、なければ未ログイン
    return c.json({ loggedIn: !!user, userId: user?.id ?? null });
  });

  return app;
};

// =================================================================
// authMiddleware のテスト
// =================================================================
describe("authMiddleware", () => {
  beforeEach(() => {
    // 各テスト前にモックをリセット（前のテストの影響を受けないように）
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------
  // ケース1: 正常系（有効なトークン・アクティブなユーザー）
  // -------------------------------------------------------------------
  it("有効なトークンで 200 を返し、user を c にセットする", async () => {
    // Arrange（準備）: DB がユーザーを返すようにモック設定
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveUser as never);

    const app = createApp();
    const token = await createToken();

    // Act（実行）: リクエストをシミュレート
    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Assert（検証）
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe("user-1");
    expect(body.role).toBe("USER");
  });

  // -------------------------------------------------------------------
  // ケース2: Authorization ヘッダーなし → 401
  // -------------------------------------------------------------------
  it("Authorization ヘッダーがない場合は 401 を返す", async () => {
    const app = createApp();
    const res = await app.request("/protected");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("認証が必要です");
  });

  // -------------------------------------------------------------------
  // ケース3: 不正なトークン（署名が違う・形式がおかしい）→ 401
  // -------------------------------------------------------------------
  it("不正なトークンの場合は 401 を返す", async () => {
    const app = createApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer this-is-not-a-valid-jwt" },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("トークンが無効です");
  });

  // -------------------------------------------------------------------
  // ケース4: 期限切れトークン → 401
  // -------------------------------------------------------------------
  it("期限切れトークンの場合は 401 を返す", async () => {
    const app = createApp();
    // exp に過去の時刻を設定して期限切れトークンを作成
    const expiredToken = await sign(
      {
        sub: "user-1",
        role: "USER",
        exp: Math.floor(Date.now() / 1000) - 100, // 100秒前に期限切れ
      },
      TEST_SECRET,
      "HS256",
    );

    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("トークンが無効です");
  });

  it("物理削除後: 古いaccess tokenのUser rowが存在しない場合は401を返す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const app = createApp();
    const token = await createToken();

    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "ユーザーが見つかりません" });
  });

  // -------------------------------------------------------------------
  // ケース5: isActive=false（停止済みアカウント）→ 403
  // -------------------------------------------------------------------
  it("isActive=false のユーザーは 403 を返す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockActiveUser,
      isActive: false,
    } as never);

    const app = createApp();
    const token = await createToken();

    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("アカウントが停止されています");
  });

  // -------------------------------------------------------------------
  // ケース6: emailVerified=false（メール未認証）→ 403
  // -------------------------------------------------------------------
  it("emailVerified=false のユーザーは 403 を返す", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockActiveUser,
      emailVerified: false,
    } as never);

    const app = createApp();
    const token = await createToken();

    const res = await app.request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("メールアドレスが確認されていません");
  });
});

// =================================================================
// optionalAuthMiddleware のテスト
// =================================================================
describe("optionalAuthMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("トークンなしでも 200 を返す（user は null）", async () => {
    const app = createOptionalApp();
    const res = await app.request("/public");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.loggedIn).toBe(false);
    expect(body.userId).toBeNull();
  });

  it("有効なトークンがあれば user をセットする", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockActiveUser as never);

    const app = createOptionalApp();
    const token = await createToken();

    const res = await app.request("/public", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.loggedIn).toBe(true);
    expect(body.userId).toBe("user-1");
  });

  it("isActive=false のユーザーは匿名扱いで通過する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockActiveUser,
      isActive: false,
    } as never);

    const app = createOptionalApp();
    const token = await createToken();

    const res = await app.request("/public", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.loggedIn).toBe(false);
    expect(body.userId).toBeNull();
  });

  it("emailVerified=false のユーザーは匿名扱いで通過する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockActiveUser,
      emailVerified: false,
    } as never);

    const app = createOptionalApp();
    const token = await createToken();

    const res = await app.request("/public", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.loggedIn).toBe(false);
    expect(body.userId).toBeNull();
  });

  it("lockedUntil が未来のユーザーは匿名扱いで通過する", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockActiveUser,
      lockedUntil: new Date(Date.now() + 60_000),
    } as never);

    const app = createOptionalApp();
    const token = await createToken();

    const res = await app.request("/public", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.loggedIn).toBe(false);
    expect(body.userId).toBeNull();
  });

  it("トークンが不正な場合は 401 を返す", async () => {
    const app = createOptionalApp();
    const res = await app.request("/public", {
      headers: { Authorization: "Bearer invalid-token" },
    });

    expect(res.status).toBe(401);
  });
});
